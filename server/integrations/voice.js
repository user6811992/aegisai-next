// server/integrations/voice.js
const integration = {
  name: 'voice',
  isAvailable: () => true,
  tools: () => [],
  status: () => ({
    ready: true,
    error: null,
    toolCount: 0,
    note: process.env.STT_URL || process.env.TTS_URL ? 'backend STT/TTS configured' : 'browser Web Speech API (no backend needed)',
    sttUrl: process.env.STT_URL || null,
    ttsUrl: process.env.TTS_URL || null,
  }),
};

module.exports = { integration };
