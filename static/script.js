let currentTaskId = null;
let statusInterval = null;
let searchResults = [];

// Save mode to localStorage (global function)
function saveMode(mode) {
    localStorage.setItem('youtube-downloader-mode', mode);
}

// Set search mode (global function)
function setSearchMode() {
    const currentModeText = document.getElementById('currentModeText');
    const searchSection = document.getElementById('searchSection');
    const downloadSection = document.getElementById('downloadSection');
    const searchResults = document.getElementById('searchResults');
    
    if (currentModeText) currentModeText.textContent = 'Current: Search Videos Mode';
    
    // Simple display switching
    if (downloadSection) downloadSection.style.display = 'none';
    if (searchSection) searchSection.style.display = 'block';
    
    if (typeof hideError === 'function') hideError();
    if (typeof hideDownloadStatus === 'function') hideDownloadStatus();
}

// Set download mode (global function)
function setDownloadMode() {
    const currentModeText = document.getElementById('currentModeText');
    const searchSection = document.getElementById('searchSection');
    const downloadSection = document.getElementById('downloadSection');
    const searchResults = document.getElementById('searchResults');
    
    if (currentModeText) currentModeText.textContent = 'Current: Direct URL Mode';
    
    // Simple display switching
    if (searchSection) searchSection.style.display = 'none';
    if (searchResults) searchResults.style.display = 'none';
    if (downloadSection) downloadSection.style.display = 'block';
    
    if (typeof hideError === 'function') hideError();
}

document.addEventListener('DOMContentLoaded', function() {
    const downloadForm = document.getElementById('downloadForm');
    const previewBtn = document.getElementById('previewBtn');
    const searchBtn = document.getElementById('searchBtn');
    const url = document.getElementById('url');
    const quality = document.getElementById('quality');
    const searchQuery = document.getElementById('searchQuery');
    const previewSection = document.getElementById('previewSection');
    const previewContent = document.getElementById('previewContent');
    const downloadStatus = document.getElementById('downloadStatus');
    const errorSection = document.getElementById('errorSection');
    const errorMessage = document.getElementById('errorMessage');
    const searchSection = document.getElementById('searchSection');
    const downloadSection = document.getElementById('downloadSection');
    const searchResults = document.getElementById('searchResults');
    const searchResultsList = document.getElementById('searchResultsList');

    // Mode toggle functionality
    const searchModeBtn = document.getElementById('searchMode');
    const downloadModeBtn = document.getElementById('downloadMode');

    // Load saved mode from localStorage
    function loadSavedMode() {
        const savedMode = localStorage.getItem('youtube-downloader-mode');
        if (savedMode === 'search') {
            searchModeBtn.checked = true;
            setSearchMode();
        } else {
            // Default to download mode
            downloadModeBtn.checked = true;
            setDownloadMode();
        }
    }

    searchModeBtn.addEventListener('change', function() {
        if (this.checked) {
            saveMode('search');
            setSearchMode();
        }
    });

    downloadModeBtn.addEventListener('change', function() {
        if (this.checked) {
            saveMode('download');
            setDownloadMode();
        }
    });

    // Preview button click
    previewBtn.addEventListener('click', async function() {
        if (!url.value) {
            showError('Please enter a YouTube URL');
            return;
        }

        previewBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        previewBtn.disabled = true;

        try {
            const response = await fetch(`/info?url=${encodeURIComponent(url.value)}`);
            const data = await response.json();

            if (response.ok) {
                displayPreview(data);
                hideError();
            } else {
                showError(data.detail || 'Error fetching audio info');
            }
        } catch (error) {
            showError('Network error: ' + error.message);
        } finally {
            previewBtn.innerHTML = '<i class="fas fa-eye"></i> Preview Audio Info';
            previewBtn.disabled = false;
        }
    });

    // Form submission
    downloadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!url.value) {
            showError('Please enter a YouTube URL');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting Conversion...';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url.value,
                    quality: quality.value
                })
            });

            const data = await response.json();

            if (response.ok) {
                currentTaskId = data.task_id;
                showDownloadStatus();
                startStatusPolling();
                hideError();
            } else {
                showError(data.detail || 'Error starting MP3 conversion');
            }
        } catch (error) {
            showError('Network error: ' + error.message);
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // Download file button
    document.getElementById('downloadFileBtn').addEventListener('click', function() {
        if (currentTaskId) {
            window.open(`/download/${currentTaskId}`, '_blank');
        }
    });

    // Cleanup button
    // document.getElementById('cleanupBtn').addEventListener('click', async function() {
    //     if (currentTaskId) {
    //         try {
    //             await fetch(`/cleanup/${currentTaskId}`, { method: 'DELETE' });
    //             hideDownloadStatus();
    //             currentTaskId = null;
    //         } catch (error) {
    //             console.error('Cleanup error:', error);
    //         }
    //     }
    // });

    // Search functionality
    searchBtn.addEventListener('click', async function() {
        if (!searchQuery.value.trim()) {
            showError('Please enter a search query');
            return;
        }

        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';
        searchBtn.disabled = true;

        try {
            const response = await fetch('/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: searchQuery.value.trim(),
                    max_results: 5
                })
            });

            const data = await response.json();

            if (response.ok) {
                displaySearchResults(data.results);
                hideError();
            } else {
                showError(data.detail || 'Error searching videos');
            }
        } catch (error) {
            showError('Network error: ' + error.message);
        } finally {
            searchBtn.innerHTML = '<i class="fas fa-search"></i> Search Videos';
            searchBtn.disabled = false;
        }
    });

    // Search on Enter key
    searchQuery.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    // Load saved mode from localStorage
    loadSavedMode();
});

function displayPreview(data) {
    const previewSection = document.getElementById('previewSection');
    const previewContent = document.getElementById('previewContent');
    
    let html = '';
    
    if (data.type === 'playlist') {
        html = `
            <div class="row">
                <div class="col-md-12">
                    <h6><i class="fas fa-list"></i> Playlist: ${data.title}</h6>
                    <p><strong>Total Audio Tracks:</strong> ${data.video_count}</p>
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> All ${data.video_count} videos will be converted to MP3 format
                    </div>
                    <div class="mt-3">
                        <h6>First ${Math.min(10, data.videos.length)} tracks:</h6>
                        <div class="list-group">
        `;
        
        data.videos.forEach((video, index) => {
            const duration = formatDuration(video.duration);
            html += `
                <div class="list-group-item">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1"><i class="fas fa-music text-primary"></i> ${index + 1}. ${video.title}</h6>
                        <small><i class="fas fa-clock"></i> ${duration}</small>
                    </div>
                    <small class="text-muted">by ${video.uploader}</small>
                </div>
            `;
        });
        
        html += `
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        const duration = formatDuration(data.duration);
        html = `
            <div class="row">
                <div class="col-md-12">
                    <h6><i class="fas fa-music text-primary"></i> Audio Track: ${data.title}</h6>
                    <p><strong>Duration:</strong> <i class="fas fa-clock"></i> ${duration}</p>
                    <p><strong>Artist/Channel:</strong> ${data.uploader}</p>
                    <p><strong>Views:</strong> ${data.view_count ? data.view_count.toLocaleString() : 'N/A'}</p>
                    ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i> This video will be converted to high-quality MP3 audio
                    </div>
                </div>
            </div>
        `;
    }
    
    previewContent.innerHTML = html;
    previewSection.style.display = 'block';
}

function formatDuration(seconds) {
    if (!seconds) return 'N/A';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

function showDownloadStatus() {
    document.getElementById('downloadStatus').style.display = 'block';
    document.getElementById('status').textContent = 'Starting Conversion...';
    document.getElementById('status').className = 'badge bg-primary';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressBar').textContent = '0%';
    document.getElementById('downloadActions').style.display = 'none';
}

function hideDownloadStatus() {
    document.getElementById('downloadStatus').style.display = 'none';
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
}

function startStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
    }
    
    statusInterval = setInterval(async () => {
        if (!currentTaskId) return;
        
        try {
            const response = await fetch(`/status/${currentTaskId}`);
            const data = await response.json();
            
            updateStatus(data);
            
            if (data.status === 'completed' || data.status === 'error') {
                clearInterval(statusInterval);
                statusInterval = null;
            }
        } catch (error) {
            console.error('Status polling error:', error);
        }
    }, 1000);
}

function updateStatus(data) {
    const statusElement = document.getElementById('status');
    const progressBar = document.getElementById('progressBar');
    const downloadInfo = document.getElementById('downloadInfo');
    const downloadActions = document.getElementById('downloadActions');
    
    // Update status badge
    let statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);
    if (data.status === 'downloading') {
        statusText = 'Converting to MP3...';
    }
    statusElement.textContent = statusText;
    
    switch (data.status) {
        case 'started':
        case 'downloading':
            statusElement.className = 'badge bg-primary';
            progressBar.style.width = `${data.progress || 0}%`;
            progressBar.textContent = `${data.progress || 0}%`;
            break;
        case 'completed':
            statusElement.className = 'badge bg-success';
            statusElement.textContent = 'MP3 Conversion Complete!';
            progressBar.style.width = '100%';
            progressBar.textContent = '100%';
            progressBar.classList.remove('progress-bar-animated');
            downloadActions.style.display = 'block';
            break;
        case 'error':
            statusElement.className = 'badge bg-danger';
            statusElement.textContent = 'Conversion Failed';
            progressBar.classList.remove('progress-bar-animated');
            showError(data.error || 'Unknown error occurred during MP3 conversion');
            break;
    }
    
    // Update download info
    let infoHtml = '';
    if (data.is_playlist !== undefined) {
        infoHtml += `<p><strong>Type:</strong> ${data.is_playlist ? 'Playlist (Multiple MP3s)' : 'Single MP3 File'}</p>`;
    }
    if (data.total_videos) {
        infoHtml += `<p><strong>Total Tracks:</strong> ${data.total_videos}</p>`;
    }
    if (data.files && data.files.length > 0) {
        infoHtml += `<p><strong>MP3 Files Ready:</strong> ${data.files.length}</p>`;
    }
    
    downloadInfo.innerHTML = infoHtml;
}

function showError(message) {
    const errorSection = document.getElementById('errorSection');
    const errorMessage = document.getElementById('errorMessage');
    
    // Format common error messages for better user understanding
    let formattedMessage = message;
    if (message.includes('precondition check failed') || message.includes('YouTube API error')) {
        formattedMessage = '⚠️ YouTube API Issue: This video may be restricted or temporarily unavailable. Please try again in a few minutes, or try a different video.';
    } else if (message.includes('private')) {
        formattedMessage = '🔒 This video is private and cannot be downloaded.';
    } else if (message.includes('deleted')) {
        formattedMessage = '❌ This video has been deleted and is no longer available.';
    } else if (message.includes('No valid videos found')) {
        formattedMessage = '📭 No downloadable videos found in this playlist. The videos may be private or restricted.';
    } else if (message.includes('HTTP Error 400') || message.includes('Bad Request')) {
        formattedMessage = '🔄 YouTube API error. Please try again in a few moments. If the problem persists, the video may be restricted.';
    }
    
    errorMessage.innerHTML = formattedMessage;
    errorSection.style.display = 'block';
    
    // Auto-hide after 15 seconds for better user experience
    setTimeout(() => {
        hideError();
    }, 15000);
}

function hideError() {
    document.getElementById('errorSection').style.display = 'none';
}

function displaySearchResults(results) {
    const searchResultsSection = document.getElementById('searchResults');
    const searchResultsList = document.getElementById('searchResultsList');
    
    if (!results || results.length === 0) {
        searchResultsList.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-search text-muted" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h5 class="text-muted">No videos found</h5>
                <p class="text-muted">Try different search terms</p>
            </div>
        `;
        searchResultsSection.style.display = 'block';
        return;
    }
    
    let html = '';
    
    results.forEach((video, index) => {
        const duration = formatDuration(video.duration);
        const viewCount = video.view_count ? formatNumber(video.view_count) : 'N/A';
        const thumbnailUrl = video.thumbnail || '/static/default-thumbnail.svg';
        const escapedUrl = video.url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        
        html += `
            <div class="result-item" data-video-url="${video.url}" data-video-id="${video.id}">
                <div class="result-header">
                    <div class="result-info">
                        <h6 class="result-title">${video.title}</h6>
                        <div class="result-meta">
                            <span><i class="fas fa-user"></i> ${video.uploader}</span>
                            <span><i class="fas fa-clock"></i> ${duration}</span>
                            <span><i class="fas fa-eye"></i> ${viewCount} views</span>
                        </div>
                        ${video.description ? `<p class="result-description">${video.description}</p>` : ''}
                        <div class="result-actions">
                            <div class="quality-selector-mini">
                                <select class="form-select form-select-sm" data-quality-selector="${index}">
                                    <option value="320">320 kbps</option>
                                    <option value="256">256 kbps</option>
                                    <option value="192" selected>192 kbps</option>
                                    <option value="128">128 kbps</option>
                                    <option value="96">96 kbps</option>
                                </select>
                            </div>
                            <button class="btn btn-download-result" onclick="downloadFromSearch('${escapedUrl}', ${index})">
                                <i class="fas fa-download"></i> Download MP3
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    searchResultsList.innerHTML = html;
    searchResultsSection.style.display = 'block';
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

async function downloadFromSearch(videoUrl, index) {
    const qualitySelector = document.querySelector(`[data-quality-selector="${index}"]`);
    const downloadBtn = document.querySelector(`[onclick*="downloadFromSearch('${videoUrl.replace(/'/g, "\\'")}', ${index})"]`);
    const quality = qualitySelector.value;
    
    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
    downloadBtn.disabled = true;
    
    try {
        const response = await fetch('/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: videoUrl,
                quality: quality
            })
        });

        const data = await response.json();

        if (response.ok) {
            currentTaskId = data.task_id;
            showDownloadStatus();
            startStatusPolling();
            hideError();
            
            // Switch to download section to show progress
            document.getElementById('downloadMode').checked = true;
            saveMode('download');
            setDownloadMode();
        } else {
            showError(data.detail || 'Error starting MP3 conversion');
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    } finally {
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
    }
}
