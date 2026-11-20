// server/integrations/voice.js
const http = require('http');

const STT_PORTS = [8001, 8000];
const TTS_PORTS = [7878, 8002];

async function probe(port, path) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:' + port + path, (res) => { resolve(res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function detect() {
  if (!process.env.STT_URL) {
    for (const p of STT_PORTS) {
      if (await probe(p, '/v1/audio/transcriptions') || await probe(p, '/health')) {
        process.env.STT_URL = 'http://127.0.0.1:' + p; break;
      }
    }
  }
  if (!process.env.TTS_URL) {
    for (const p of TTS_PORTS) {
      if (await probe(p, '/v1/audio/speech') || await probe(p, '/health')) {
        process.env.TTS_URL = 'http://127.0.0.1:' + p; break;
      }
    }
  }
}

const integration = {
  name: 'voice',
  isAvailable: () => true,
  tools: () => [],
  status: async () => {
    await detect();
    return {
      ready: true,
      error: null,
      toolCount: 0,
      note: (process.env.STT_URL || process.env.TTS_URL) ? ('STT: ' + (process.env.STT_URL || 'browser') + ' | TTS: ' + (process.env.TTS_URL || 'browser')) : 'browser Web Speech API (no backend needed)',
      sttUrl: process.env.STT_URL || null,
      ttsUrl: process.env.TTS_URL || null,
    };
  },
};

module.exports = { integration, detect };
