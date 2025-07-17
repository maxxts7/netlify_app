const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const { url } = JSON.parse(event.body);
    
    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'YouTube URL is required' })
      };
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    if (!youtubeRegex.test(url)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid YouTube URL' })
      };
    }

    // Create temporary directory for downloads
    const tempDir = `/tmp/yt-${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });

    const transcript = await extractTranscript(url, tempDir);
    
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        transcript: transcript,
        url: url 
      })
    };

  } catch (error) {
    console.error('Error extracting transcript:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to extract transcript', 
        details: error.message 
      })
    };
  }
};

function extractTranscript(url, tempDir) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = '/home/manu/anaconda3/bin/yt-dlp';
    
    const args = [
      '--write-auto-sub',
      '--sub-lang', 'en',
      '--sub-format', 'vtt',
      '--skip-download',
      '--output', path.join(tempDir, '%(title)s.%(ext)s'),
      url
    ];

    const ytdlp = spawn(ytDlpPath, args);
    
    let stderr = '';
    let stdout = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Find the VTT file
        const files = fs.readdirSync(tempDir);
        const vttFile = files.find(file => file.endsWith('.vtt'));
        
        if (!vttFile) {
          reject(new Error('No transcript file found. Video may not have subtitles.'));
          return;
        }

        const vttPath = path.join(tempDir, vttFile);
        const vttContent = fs.readFileSync(vttPath, 'utf8');
        
        // Parse VTT content to extract text
        const transcript = parseVTT(vttContent);
        resolve(transcript);
        
      } catch (error) {
        reject(new Error(`Failed to process transcript: ${error.message}`));
      }
    });

    ytdlp.on('error', (error) => {
      reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
    });
  });
}

function parseVTT(vttContent) {
  const lines = vttContent.split('\n');
  const transcript = [];
  let currentText = '';
  let currentTimestamp = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip WEBVTT header and empty lines
    if (line === 'WEBVTT' || line === '' || line.startsWith('NOTE')) {
      continue;
    }
    
    // Timestamp line (contains -->)
    if (line.includes('-->')) {
      // If we have accumulated text, save it
      if (currentText && currentTimestamp) {
        transcript.push({
          timestamp: currentTimestamp,
          text: currentText.trim()
        });
      }
      
      currentTimestamp = line.split('-->')[0].trim();
      currentText = '';
    } else {
      // Text line
      currentText += line + ' ';
    }
  }
  
  // Add the last entry
  if (currentText && currentTimestamp) {
    transcript.push({
      timestamp: currentTimestamp,
      text: currentText.trim()
    });
  }
  
  return transcript;
}