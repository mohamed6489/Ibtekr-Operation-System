// ElevenLabs, direct (phase 11, decision 15: the voice-over of a campaign video with the admin's own key, beside the Magnific
// bridge's audio_tts). One call: text-to-speech → MP3 bytes. The key goes in the xi-api-key header only; nothing is logged. The
// cost is counted in USD on the content cap by index.ts (VOICE_USD_PER_1K).
import { ProviderError } from './magnific.ts';

const API = 'https://api.elevenlabs.io/v1';
const TIMEOUT_MS = 120_000;
export const ELEVEN_MODELS = ['eleven_v3', 'eleven_multilingual_v2'];
// a premade multilingual voice when the admin mapped none for the catalog voice (settings «ai».providers.voice.elevenVoices)
export const ELEVEN_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

export async function elevenTts(env: Record<string, string | undefined>, req: { text: string; voiceId: string | null; model: string | null }, fetchFn: typeof fetch = fetch): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = (env.ELEVENLABS_API_KEY ?? '').trim(); if (!key) throw new ProviderError('not_configured');
  const voice = req.voiceId && VOICE_ID.test(req.voiceId) ? req.voiceId : ELEVEN_DEFAULT_VOICE;
  const model = req.model && ELEVEN_MODELS.includes(req.model) ? req.model : ELEVEN_MODELS[0];
  let res: Response;
  try {
    res = await fetchFn(API + '/text-to-speech/' + voice + '?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: req.text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
  if (!res.ok) {
    let detail: string | null = null; try { const j = await res.json(); detail = typeof j?.detail?.message === 'string' ? j.detail.message.slice(0, 160) : typeof j?.detail?.status === 'string' ? j.detail.status : null; } catch { detail = null; }
    throw new ProviderError(res.status === 401 || res.status === 403 ? 'not_configured' : res.status === 429 || res.status >= 500 ? 'busy' : 'ai_error', res.status, detail);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 100) throw new ProviderError('ai_error', res.status, 'empty audio');
  return { bytes, mime: 'audio/mpeg' };
}
