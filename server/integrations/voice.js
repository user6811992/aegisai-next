// server/integrations/voice.js
const integration = {
  name: 'voice',
  isAvailable: () => !!(process.env.STT_URL || process.env.TTS_URL),
  tools: () => [],
  status: () => ({
    ready: !!(process.env.STT_URL || process.env.TTS_URL),
    error: null,
    toolCount: 0,
    sttUrl: process.env.STT_URL || null,
    ttsUrl: process.env.TTS_URL || null,
  }),
};

module.exports = { integration };
