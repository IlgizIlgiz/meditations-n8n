const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Увеличиваем таймауты для больших файлов
const server = require('http').createServer();
server.timeout = 300000; // 5 минут
server.keepAliveTimeout = 300000;
server.headersTimeout = 300000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create directories
const TEMP_DIR = path.join(__dirname, 'temp');
const OUTPUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: TEMP_DIR,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Utility function to clean up files
const cleanupFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// Get audio duration using ffprobe
const getAudioDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
};

// Mix audio with ambient track
const mixWithAmbient = (voiceFile, ambientFile, outputFile, voiceDuration) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(voiceFile)
      .input(ambientFile)
      .complexFilter([
        // Loop ambient track to match voice duration
        `[1:a]aloop=loop=-1:size=2e+09[ambient_loop]`,
        // Trim ambient to voice duration
        `[ambient_loop]atrim=duration=${voiceDuration}[ambient_trimmed]`,
        // Mix voice and ambient (voice at full volume, ambient at 30%)
        `[0:a][ambient_trimmed]amix=inputs=2:weights=1 0.3[mixed]`
      ])
      .outputOptions([
        '-map', '[mixed]',
        '-c:a', 'libmp3lame',
        '-b:a', '128k'
      ])
      .output(outputFile)
      .on('end', () => resolve(outputFile))
      .on('error', reject)
      .run();
  });
};

// Main processing endpoint
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  let tempFiles = [];
  
  try {
    const { chatId, userName, goal, returnUrl } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`Processing audio for user: ${userName}, chat: ${chatId}`);
    
    const voiceFile = req.file.path;
    tempFiles.push(voiceFile);
    
    // Get voice duration
    const voiceDuration = await getAudioDuration(voiceFile);
    console.log(`Voice duration: ${voiceDuration} seconds`);
    
    // Path to ambient track (you'll need to upload this to your VPS)
    const ambientFile = path.join(__dirname, 'assets', 'ambient.mp3');
    
    if (!fs.existsSync(ambientFile)) {
      console.warn('Ambient file not found, proceeding without mixing');
      // If no ambient file, just convert to MP3 and return
      const outputFile = path.join(OUTPUT_DIR, `${uuidv4()}.mp3`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(voiceFile)
          .toFormat('mp3')
          .audioBitrate(128)
          .output(outputFile)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      // Send file back or upload to storage
      if (returnUrl) {
        // Send processed file back to n8n workflow
        const audioBuffer = fs.readFileSync(outputFile);
        await axios.post(returnUrl, {
          chatId,
          userName,
          goal,
          audioData: audioBuffer.toString('base64'),
          duration: voiceDuration,
          processed: true
        });
        
        cleanupFile(outputFile);
        res.json({ success: true, message: 'Audio processed and sent back' });
      } else {
        // Return file directly
        res.download(outputFile, `meditation-${chatId}.mp3`, (err) => {
          if (!err) cleanupFile(outputFile);
        });
      }
      
      return;
    }
    
    // Mix with ambient track
    const outputFile = path.join(OUTPUT_DIR, `meditation-${chatId}-${uuidv4()}.mp3`);
    tempFiles.push(outputFile);
    
    await mixWithAmbient(voiceFile, ambientFile, outputFile, voiceDuration);
    console.log('Audio mixing completed');
    
    // Calculate final duration
    const finalDuration = await getAudioDuration(outputFile);
    
    if (returnUrl) {
      // Send processed file back to n8n workflow
      const audioBuffer = fs.readFileSync(outputFile);
      
      await axios.post(returnUrl, {
        chatId,
        userName,
        goal,
        audioData: audioBuffer.toString('base64'),
        duration: finalDuration,
        processed: true,
        mixed: true
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      console.log('Processed audio sent back to n8n');
      res.json({ 
        success: true, 
        message: 'Audio processed and sent back',
        duration: finalDuration
      });
    } else {
      // Return file directly
      res.download(outputFile, `meditation-${chatId}.mp3`, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
      });
    }
    
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: 'Audio processing failed', 
      details: error.message 
    });
  } finally {
    // Cleanup temp files
    tempFiles.forEach(cleanupFile);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Process base64 audio data (alternative endpoint)
app.post('/process-base64', async (req, res) => {
  let tempFiles = [];
  
  try {
    const { audioData, chatId, userName, goal, returnUrl } = req.body;
    
    if (!audioData) {
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    // Decode base64 PCM audio from Google TTS
    const pcmBuffer = Buffer.from(audioData, 'base64');
    
    // Convert PCM to WAV (Google TTS returns s16le, 24kHz, mono)
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;
    
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM fmt chunk size
    header.writeUInt16LE(1, 20);  // Audio format PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    const wavBuffer = Buffer.concat([header, pcmBuffer]);
    
    // Save WAV file
    const voiceFile = path.join(TEMP_DIR, `voice-${uuidv4()}.wav`);
    fs.writeFileSync(voiceFile, wavBuffer);
    tempFiles.push(voiceFile);
    
    console.log(`Processing base64 audio for user: ${userName}, chat: ${chatId}`);
    
    // Get voice duration
    const voiceDuration = await getAudioDuration(voiceFile);
    console.log(`Voice duration: ${voiceDuration} seconds`);
    
    // Path to ambient track
    const ambientFile = path.join(__dirname, 'assets', 'ambient.mp3');
    
    if (!fs.existsSync(ambientFile)) {
      console.warn('Ambient file not found, proceeding without mixing');
      const outputFile = path.join(OUTPUT_DIR, `${uuidv4()}.mp3`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(voiceFile)
          .toFormat('mp3')
          .audioBitrate(128)
          .output(outputFile)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      const processedBuffer = fs.readFileSync(outputFile);
      cleanupFile(outputFile);
      
      res.json({
        success: true,
        audioData: processedBuffer.toString('base64'),
        duration: voiceDuration,
        processed: true,
        mixed: false
      });
      
      return;
    }
    
    // Mix with ambient track
    const outputFile = path.join(OUTPUT_DIR, `meditation-${chatId}-${uuidv4()}.mp3`);
    tempFiles.push(outputFile);
    
    await mixWithAmbient(voiceFile, ambientFile, outputFile, voiceDuration);
    
    // Calculate final duration
    const finalDuration = await getAudioDuration(outputFile);
    
    // Read processed file
    const processedBuffer = fs.readFileSync(outputFile);
    
    res.json({
      success: true,
      chatId,
      userName,
      goal,
      duration: finalDuration,
      processed: true,
      mixed: true,
      audioData: processedBuffer.toString('base64'),
      binary: {
        data: {
          data: processedBuffer,
          mimeType: 'audio/mp3',
          fileName: `meditation-${chatId}.mp3`
        }
      }
    });
    
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: 'Audio processing failed', 
      details: error.message 
    });
  } finally {
    // Cleanup temp files
    tempFiles.forEach(cleanupFile);
  }
});

// Start server with custom timeouts
server.on('request', app);
server.listen(PORT, () => {
  console.log(`Audio processing server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Server timeouts: ${server.timeout}ms`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});
