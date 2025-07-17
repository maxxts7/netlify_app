document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('transcriptForm');
    const urlInput = document.getElementById('youtubeUrl');
    const extractBtn = document.getElementById('extractBtn');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const result = document.getElementById('result');
    const errorMessage = document.getElementById('errorMessage');
    const videoUrl = document.getElementById('videoUrl');
    const transcript = document.getElementById('transcript');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');

    let currentTranscript = '';

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        if (!isValidYouTubeUrl(url)) {
            showError('Please enter a valid YouTube URL');
            return;
        }

        showLoading();
        hideError();
        hideResult();

        try {
            const response = await fetch('/.netlify/functions/extract-transcript', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to extract transcript');
            }

            if (data.success) {
                showResult(data.transcript, data.url);
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }

        } catch (err) {
            console.error('Error:', err);
            showError(err.message);
        } finally {
            hideLoading();
        }
    });

    copyBtn.addEventListener('click', function() {
        if (currentTranscript) {
            navigator.clipboard.writeText(currentTranscript).then(function() {
                copyBtn.textContent = 'Copied!';
                setTimeout(function() {
                    copyBtn.textContent = 'Copy to Clipboard';
                }, 2000);
            }).catch(function(err) {
                console.error('Failed to copy text: ', err);
                showError('Failed to copy transcript to clipboard');
            });
        }
    });

    downloadBtn.addEventListener('click', function() {
        if (currentTranscript) {
            const blob = new Blob([currentTranscript], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'youtube-transcript.txt';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }
    });

    function isValidYouTubeUrl(url) {
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
        return youtubeRegex.test(url);
    }

    function showLoading() {
        loading.classList.remove('hidden');
        extractBtn.disabled = true;
        extractBtn.textContent = 'Extracting...';
    }

    function hideLoading() {
        loading.classList.add('hidden');
        extractBtn.disabled = false;
        extractBtn.textContent = 'Extract Transcript';
    }

    function showError(message) {
        errorMessage.textContent = message;
        error.classList.remove('hidden');
    }

    function hideError() {
        error.classList.add('hidden');
    }

    function showResult(transcriptData, url) {
        videoUrl.textContent = url;
        
        // Clear previous transcript
        transcript.innerHTML = '';
        
        // Build transcript text for copying/downloading
        let fullText = '';
        
        if (Array.isArray(transcriptData) && transcriptData.length > 0) {
            transcriptData.forEach(function(item) {
                // Create transcript item element
                const transcriptItem = document.createElement('div');
                transcriptItem.className = 'transcript-item';
                
                const timestampDiv = document.createElement('div');
                timestampDiv.className = 'timestamp';
                timestampDiv.textContent = item.timestamp || 'Unknown time';
                
                const textDiv = document.createElement('div');
                textDiv.className = 'text';
                textDiv.textContent = item.text || '';
                
                transcriptItem.appendChild(timestampDiv);
                transcriptItem.appendChild(textDiv);
                transcript.appendChild(transcriptItem);
                
                // Add to full text for copying
                fullText += `[${item.timestamp || 'Unknown time'}] ${item.text || ''}\n\n`;
            });
        } else {
            // Handle case where transcript is a simple string
            const transcriptItem = document.createElement('div');
            transcriptItem.className = 'transcript-item';
            
            const textDiv = document.createElement('div');
            textDiv.className = 'text';
            textDiv.textContent = typeof transcriptData === 'string' ? transcriptData : 'No transcript available';
            
            transcriptItem.appendChild(textDiv);
            transcript.appendChild(transcriptItem);
            
            fullText = typeof transcriptData === 'string' ? transcriptData : 'No transcript available';
        }
        
        currentTranscript = fullText;
        result.classList.remove('hidden');
        
        // Scroll to result
        result.scrollIntoView({ behavior: 'smooth' });
    }

    function hideResult() {
        result.classList.add('hidden');
    }
});