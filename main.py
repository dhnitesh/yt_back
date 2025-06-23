"""
YouTube to MP3 Downloader FastAPI Application

A web application for downloading YouTube videos as MP3 audio files.
Supports both single videos and playlists with real-time progress tracking.
"""

import logging
import time
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, HttpUrl
import yt_dlp

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration constants
DEFAULT_AUDIO_QUALITY = "192"  # Default audio quality in kbps
MAX_RECENT_FILE_AGE = 600  # Maximum age in seconds for recent files (10 minutes)
STATUS_POLL_INTERVAL = 1000  # Frontend polling interval in milliseconds
RETRIES = 3  # Number of retries for downloads
FRAGMENT_RETRIES = 3  # Number of retries for fragments

app = FastAPI(
    title="YouTube to MP3 Downloader", 
    description="Download YouTube videos as MP3 audio files",
    version="1.0.0"
)

# Create directories
DOWNLOAD_DIR = Path("downloads")
TEMP_DIR = Path("temp")
DOWNLOAD_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Store download tasks
download_tasks = {}

def get_yt_dlp_options(quality: str) -> dict:
    """Get yt-dlp configuration options"""
    return {
        'outtmpl': str(DOWNLOAD_DIR / '%(title)s.%(ext)s'),
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': quality,
        }],
        'extract_flat': False,
        'writethumbnail': False,
        'writeinfojson': False,
        'ignoreerrors': True,
        'no_warnings': False,
        'retries': RETRIES,
        'fragment_retries': FRAGMENT_RETRIES,
        'extractor_args': {
            'youtube': {
                'skip': ['hls', 'dash'],  # Skip problematic formats
                'player_client': ['android', 'web'],  # Try multiple clients
            }
        },
        'age_limit': None,
        'writesubtitles': False,
        'writeautomaticsub': False,
    }

def create_progress_hook(task_id: str):
    """Create a progress hook function for yt-dlp"""
    def progress_hook(d):
        try:
            if d['status'] == 'downloading':
                if 'total_bytes' in d and d['total_bytes']:
                    progress = (d['downloaded_bytes'] / d['total_bytes']) * 100
                    download_tasks[task_id]["progress"] = round(progress, 2)
                elif '_percent_str' in d:
                    percent_str = d['_percent_str'].strip().replace('%', '')
                    try:
                        progress = float(percent_str)
                        download_tasks[task_id]["progress"] = round(progress, 2)
                    except ValueError:
                        pass
            elif d['status'] == 'processing':
                download_tasks[task_id]["progress"] = 95
        except Exception as e:
            logger.warning(f"Progress hook error for task {task_id}: {e}")
    return progress_hook

def create_postprocessor_hook(task_id: str):
    """Create a post-processor hook function for yt-dlp"""
    def postprocessor_hook(d):
        try:
            if d['status'] == 'finished':
                mp3_file = d.get('filepath') or d.get('filename') or d.get('info_dict', {}).get('filepath')
                if mp3_file and mp3_file.endswith('.mp3'):
                    if mp3_file not in download_tasks[task_id]["files"]:
                        download_tasks[task_id]["files"].append(mp3_file)
        except Exception as e:
            logger.warning(f"Post-processor hook error for task {task_id}: {e}")
    return postprocessor_hook

def get_yt_dlp_info_options() -> dict:
    """Get yt-dlp configuration options for info extraction only"""
    return {
        'quiet': True,
        'no_warnings': False,
        'ignoreerrors': True,
        'extractor_args': {
            'youtube': {
                'skip': ['hls', 'dash'],
                'player_client': ['android', 'web'],
            }
        },
    }

def handle_yt_dlp_error(error: Exception) -> HTTPException:
    """Handle yt-dlp errors and return appropriate HTTP exceptions"""
    error_msg = str(error).lower()
    
    if "precondition check failed" in error_msg:
        return HTTPException(
            status_code=400, 
            detail="YouTube API error: Video may be restricted or unavailable. Try again later."
        )
    elif "private" in error_msg:
        return HTTPException(
            status_code=400, 
            detail="This video is private and cannot be accessed."
        )
    elif "deleted" in error_msg:
        return HTTPException(
            status_code=404, 
            detail="This video has been deleted."
        )
    else:
        return HTTPException(
            status_code=400, 
            detail=f"Error processing video: {str(error)}"
        )

def find_existing_files(task_files):
    """Find existing MP3 files from task file list"""
    existing_files = []
    for file_path in task_files:
        file_obj = Path(file_path)
        if file_obj.exists():
            existing_files.append(str(file_obj))
        else:
            # Try to find MP3 version
            mp3_path = file_obj.with_suffix('.mp3')
            if mp3_path.exists():
                existing_files.append(str(mp3_path))
    
    # Fallback: find recent MP3 files if no tracked files exist
    if not existing_files:
        mp3_files = list(DOWNLOAD_DIR.glob("*.mp3"))
        if mp3_files:
            latest_mp3 = max(mp3_files, key=lambda x: x.stat().st_mtime)
            existing_files = [str(latest_mp3)]
    
    return existing_files

class DownloadRequest(BaseModel):
    url: HttpUrl
    quality: Optional[str] = DEFAULT_AUDIO_QUALITY  # Audio quality in kbps

class SearchRequest(BaseModel):
    query: str
    max_results: Optional[int] = 5

class DownloadResponse(BaseModel):
    task_id: str
    status: str
    message: str

@app.post("/search")
async def search_videos(request: SearchRequest):
    """Search for YouTube videos"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'ignoreerrors': True,
            'extract_flat': True,  # Don't download, just get metadata
            'default_search': 'ytsearch',  # Use YouTube search
        }
        
        # Search query format for yt-dlp
        search_query = f"ytsearch{request.max_results}:{request.query}"
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            search_results = ydl.extract_info(search_query, download=False)
            
            if not search_results or 'entries' not in search_results:
                return {"results": []}
            
            videos = []
            for entry in search_results['entries']:
                if entry is not None:
                    videos.append({
                        "id": entry.get('id', ''),
                        "title": entry.get('title', 'Unknown Title'),
                        "url": f"https://www.youtube.com/watch?v={entry.get('id', '')}",
                        "thumbnail": entry.get('thumbnail', ''),
                        "duration": entry.get('duration', 0),
                        "uploader": entry.get('uploader', 'Unknown'),
                        "view_count": entry.get('view_count', 0),
                        "upload_date": entry.get('upload_date', ''),
                        "description": entry.get('description', '')[:150] + "..." if entry.get('description') else ""
                    })
            
            return {"results": videos}
            
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=400, detail=f"Search failed: {str(e)}")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main page"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/download", response_model=DownloadResponse)
async def download_audio(request: DownloadRequest, background_tasks: BackgroundTasks):
    """Download audio from YouTube video or playlist"""
    task_id = str(uuid.uuid4())
    download_tasks[task_id] = {"status": "started", "progress": 0, "files": []}
    
    background_tasks.add_task(download_task, str(request.url), request.quality, task_id)
    
    return DownloadResponse(
        task_id=task_id,
        status="started",
        message="Audio download started"
    )

@app.get("/status/{task_id}")
async def get_download_status(task_id: str):
    """Get download status"""
    if task_id not in download_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return download_tasks[task_id]

@app.get("/download/{task_id}")
async def download_file(task_id: str):
    """Download the completed MP3 file(s)"""
    if task_id not in download_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = download_tasks[task_id]
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Download not completed")
    
    if not task["files"]:
        raise HTTPException(status_code=404, detail="No files found")
    
    # Find existing files
    existing_files = find_existing_files(task["files"])
    
    if not existing_files:
        raise HTTPException(status_code=404, detail="MP3 files not found on disk")
    
    # If multiple files, create a zip
    if len(existing_files) > 1:
        zip_path = TEMP_DIR / f"{task_id}_mp3s.zip"
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for file_path in existing_files:
                file_obj = Path(file_path)
                if file_obj.exists():
                    zipf.write(file_path, file_obj.name)
        
        return FileResponse(
            str(zip_path),
            filename=f"mp3_download_{task_id}.zip",
            media_type="application/zip"
        )
    else:
        file_path = existing_files[0]
        file_obj = Path(file_path)
        if file_obj.exists():
            return FileResponse(
                file_path,
                filename=file_obj.name,
                media_type="audio/mpeg"
            )
        else:
            raise HTTPException(status_code=404, detail="MP3 file not found")

async def download_task(url: str, quality: str, task_id: str):
    """Background task to download audio from video/playlist"""
    try:
        download_tasks[task_id]["status"] = "downloading"
        
        # Configure yt-dlp options for audio only
        ydl_opts = get_yt_dlp_options(quality)
        
        # Add hooks for tracking
        ydl_opts['progress_hooks'] = [create_progress_hook(task_id)]
        ydl_opts['postprocessor_hooks'] = [create_postprocessor_hook(task_id)]
        
        # Download with error handling
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                # Extract video information
                info = ydl.extract_info(url, download=False)
                
                if not info:
                    raise Exception("Could not extract video information")
                
                # Determine if playlist and set up tracking
                if 'entries' in info:
                    valid_entries = [entry for entry in info['entries'] if entry is not None]
                    download_tasks[task_id]["total_videos"] = len(valid_entries)
                    download_tasks[task_id]["is_playlist"] = True
                    
                    if not valid_entries:
                        raise Exception("No valid videos found in playlist")
                else:
                    download_tasks[task_id]["total_videos"] = 1
                    download_tasks[task_id]["is_playlist"] = False
                
                # Start download
                ydl.download([url])
                
                # Post-processing: ensure MP3 files are properly tracked
                time.sleep(2)  # Allow post-processing to complete
                
                final_mp3_files = []
                
                # Check files tracked by hooks
                for file_path in download_tasks[task_id]["files"]:
                    if file_path.endswith('.mp3') and Path(file_path).exists():
                        final_mp3_files.append(file_path)
                
                # Fallback: scan for recently created MP3 files
                if not final_mp3_files:
                    current_time = time.time()
                    for mp3_file in DOWNLOAD_DIR.glob("*.mp3"):
                        if current_time - mp3_file.stat().st_mtime < MAX_RECENT_FILE_AGE:
                            final_mp3_files.append(str(mp3_file))
                
                # Remove duplicates and handle single video case
                final_mp3_files = list(set(final_mp3_files))
                if len(final_mp3_files) > 1 and not download_tasks[task_id]["is_playlist"]:
                    # For single video, keep only the newest file
                    final_mp3_files.sort(key=lambda x: Path(x).stat().st_mtime, reverse=True)
                    final_mp3_files = final_mp3_files[:1]
                
                download_tasks[task_id]["files"] = final_mp3_files
                
                if not download_tasks[task_id]["files"]:
                    raise Exception("No MP3 files were created. The video might be unavailable or restricted.")
                
            except yt_dlp.utils.DownloadError as e:
                error_msg = str(e)
                if "precondition check failed" in error_msg.lower():
                    raise Exception("YouTube API error: Video may be restricted or unavailable. Try again later.")
                elif "private" in error_msg.lower():
                    raise Exception("This video is private and cannot be downloaded.")
                elif "deleted" in error_msg.lower():
                    raise Exception("This video has been deleted.")
                else:
                    raise Exception(f"Download failed: {error_msg}")
        
        download_tasks[task_id]["status"] = "completed"
        download_tasks[task_id]["progress"] = 100
        
    except Exception as e:
        download_tasks[task_id]["status"] = "error"
        download_tasks[task_id]["error"] = str(e)
        logger.error(f"Download task {task_id} failed: {e}")

@app.get("/info")
async def get_video_info(url: str):
    """Get video/playlist information without downloading"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': False,
            'ignoreerrors': True,
            'extractor_args': {
                'youtube': {
                    'skip': ['hls', 'dash'],
                    'player_client': ['android', 'web'],
                }
            },
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                raise Exception("Could not extract video information. The video might be unavailable or restricted.")
            
            if 'entries' in info:
                # Playlist - filter out None entries
                valid_entries = [entry for entry in info['entries'] if entry is not None]
                
                if not valid_entries:
                    raise Exception("No valid videos found in this playlist")
                
                return {
                    "type": "playlist",
                    "title": info.get('title', 'Unknown Playlist'),
                    "video_count": len(valid_entries),
                    "videos": [
                        {
                            "title": entry.get('title', 'Unknown'),
                            "duration": entry.get('duration', 0),
                            "uploader": entry.get('uploader', 'Unknown')
                        }
                        for entry in valid_entries[:10]  # Limit to first 10 for preview
                    ]
                }
            else:
                # Single video
                return {
                    "type": "video",
                    "title": info.get('title', 'Unknown'),
                    "duration": info.get('duration', 0),
                    "uploader": info.get('uploader', 'Unknown'),
                    "view_count": info.get('view_count', 0),
                    "description": info.get('description', '')[:200] + "..." if info.get('description', '') else ""
                }
                
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if "precondition check failed" in error_msg.lower():
            raise HTTPException(status_code=400, detail="YouTube API error: Video may be restricted or unavailable. Try again later.")
        elif "private" in error_msg.lower():
            raise HTTPException(status_code=400, detail="This video is private and cannot be accessed.")
        elif "deleted" in error_msg.lower():
            raise HTTPException(status_code=404, detail="This video has been deleted.")
        else:
            raise HTTPException(status_code=400, detail=f"Error fetching video info: {error_msg}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching video info: {str(e)}")

@app.delete("/cleanup/{task_id}")
async def cleanup_files(task_id: str):
    """Clean up downloaded files"""
    if task_id not in download_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = download_tasks[task_id]
    for file_path in task.get("files", []):
        try:
            if Path(file_path).exists():
                Path(file_path).unlink()
        except Exception:
            pass
    
    # Clean up zip file
    zip_path = TEMP_DIR / f"{task_id}.zip"
    if zip_path.exists():
        zip_path.unlink()
    
    del download_tasks[task_id]
    return {"message": "Files cleaned up"}

@app.get("/debug/{task_id}")
async def debug_task(task_id: str):
    """Debug endpoint to check task and file status"""
    if task_id not in download_tasks:
        return {"error": "Task not found"}
    
    task = download_tasks[task_id]
    
    # Check file existence
    file_status = []
    for file_path in task.get("files", []):
        file_obj = Path(file_path)
        mp3_path = file_obj.with_suffix('.mp3')
        file_status.append({
            "original_path": file_path,
            "exists": file_obj.exists(),
            "mp3_path": str(mp3_path),
            "mp3_exists": mp3_path.exists(),
            "size": file_obj.stat().st_size if file_obj.exists() else 0
        })
    
    # List all MP3 files in download directory
    all_mp3_files = [str(f) for f in DOWNLOAD_DIR.glob("*.mp3")]
    
    return {
        "task_id": task_id,
        "task_status": task,
        "file_status": file_status,
        "all_mp3_files": all_mp3_files,
        "download_dir": str(DOWNLOAD_DIR)
    }
