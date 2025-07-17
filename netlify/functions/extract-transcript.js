const https = require('https');
const { URL } = require('url');

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

    const transcript = await extractTranscript(url);

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

async function extractTranscript(url) {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL - could not extract video ID');
    }

    // Get player response from YouTube's Innertube API
    const playerResponse = await getPlayerResponse(videoId);
    
    // Extract caption tracks from player response
    const captionTracks = extractCaptionTracks(playerResponse);
    
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No transcript/subtitles found for this video');
    }

    // Find English captions (prefer manual over auto-generated)
    const englishTrack = findEnglishTrack(captionTracks);
    
    if (!englishTrack) {
      throw new Error('No English transcript found for this video');
    }

    // Download and parse the transcript
    const transcriptData = await downloadTranscript(englishTrack.baseUrl);
    
    return parseTranscriptData(transcriptData);
    
  } catch (error) {
    throw new Error(`Failed to extract transcript: ${error.message}`);
  }
}

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

async function getPlayerResponse(videoId) {
  const apiUrl = 'https://www.youtube.com/youtubei/v1/player';
  const requestBody = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00'
      }
    },
    videoId: videoId
  };

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(requestBody);
    const options = {
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/player',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(new Error('Failed to parse YouTube API response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`YouTube API request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

function extractCaptionTracks(playerResponse) {
  try {
    return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  } catch (error) {
    return [];
  }
}

function findEnglishTrack(captionTracks) {
  // First try to find manual English captions
  let englishTrack = captionTracks.find(track => 
    track.languageCode === 'en' && track.kind !== 'asr'
  );
  
  // If no manual captions, try auto-generated English captions
  if (!englishTrack) {
    englishTrack = captionTracks.find(track => 
      track.languageCode === 'en' && track.kind === 'asr'
    );
  }
  
  // If still no English, try any English variant
  if (!englishTrack) {
    englishTrack = captionTracks.find(track => 
      track.languageCode?.startsWith('en')
    );
  }
  
  return englishTrack;
}

async function downloadTranscript(baseUrl) {
  // Add format parameter for JSON3 format which includes timing data
  const transcriptUrl = baseUrl + '&fmt=json3';
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(transcriptUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(new Error('Failed to parse transcript data'));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Transcript download failed: ${error.message}`));
    });

    req.end();
  });
}

function parseTranscriptData(transcriptData) {
  try {
    const events = transcriptData?.events || [];
    const transcript = [];

    for (const event of events) {
      if (event.segs) {
        const startTime = event.tStartMs || 0;
        const text = event.segs.map(seg => seg.utf8 || '').join('').trim();
        
        if (text) {
          transcript.push({
            timestamp: formatTimestamp(startTime),
            text: text
          });
        }
      }
    }

    return transcript;
  } catch (error) {
    throw new Error(`Failed to parse transcript data: ${error.message}`);
  }
}

function formatTimestamp(startTimeMs) {
  const totalSeconds = Math.floor(startTimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

