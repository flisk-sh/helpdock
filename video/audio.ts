// The film's soundtrack: each scene's "vo" line spoken by a neural voice, over a synthesized music bed that ducks
// under the voice. Writes out/mix.wav and out/film.srt; render.ts muxes the mix into the MP4s.
// Voice: edge-tts (pipx install edge-tts), Microsoft's neural voices, no account or key but needs network.
// VOICE picks the voice (default en-US-AvaMultilingualNeural) and RATE its speed (e.g. +5%).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SR = 48000;

type Scene = { start: number; dur: number; vo?: string; voAt?: number };

function run(cmd: string[]) {
	const r = Bun.spawnSync(cmd);
	if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${r.stderr.toString()}`);
}

// a 16-bit PCM WAV (mono or stereo) as two channels
function readWav(path: string): [Float32Array, Float32Array] {
	const buf = readFileSync(path);
	const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let off = 12, ch = 1, data = 0, len = 0;
	while (off < v.byteLength) {
		const id = buf.toString("latin1", off, off + 4), size = v.getUint32(off + 4, true);
		if (id === "fmt ") ch = v.getUint16(off + 10, true);
		if (id === "data") { data = off + 8; len = Math.min(size, v.byteLength - data); break; }
		off += 8 + size + (size % 2);
	}
	const frames = Math.floor(len / 2 / ch), a = new Float32Array(frames), b = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		a[i] = v.getInt16(data + i * ch * 2, true) / 32768;
		b[i] = ch === 2 ? v.getInt16(data + i * 4 + 2, true) / 32768 : a[i];
	}
	return [a, b];
}

function writeWav(path: string, L: Float32Array, R: Float32Array) {
	const n = L.length, v = new DataView(new ArrayBuffer(44 + n * 4));
	const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true);
	v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 4, true);
	// soft limiter
	for (let i = 0; i < n; i++) {
		v.setInt16(44 + i * 4, Math.tanh(L[i] * 0.9) * 32767, true);
		v.setInt16(46 + i * 4, Math.tanh(R[i] * 0.9) * 32767, true);
	}
	writeFileSync(path, new Uint8Array(v.buffer));
}

/** One line of voice-over as a 48 kHz mono WAV, trailing silence trimmed. edge-tts drops a request now and then. */
function speak(text: string, path: string) {
	const mp3 = path.replace(/\.wav$/, ".mp3");
	for (let attempt = 1; ; attempt++) {
		const r = Bun.spawnSync(["edge-tts", "--voice", process.env.VOICE || "en-US-AvaMultilingualNeural",
			`--rate=${process.env.RATE || "+0%"}`, "--text", text, "--write-media", mp3]);
		if (r.exitCode === 0 && Bun.spawnSync(["ffprobe", "-v", "error", mp3]).exitCode === 0) break;
		if (attempt === 5) throw new Error(`edge-tts failed for "${text}": ${r.stderr.toString()}`);
		Bun.sleepSync(2000);
	}
	run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-af",
		"areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ar", String(SR), "-ac", "1", path]);
}

/** The music bed: 96 BPM, Fmaj9 – Am7 – Dm9 – Cmaj7, the same synth as the Flisk films (flisk-video-factory). */
function music(len: number): [Float32Array, Float32Array] {
	const n = Math.floor(len * SR), L = new Float32Array(n), R = new Float32Array(n);
	let seed = 7;
	const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
	const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
	const beat = 60 / 96, bar = beat * 4;
	const chords = [[53, 57, 60, 64, 67], [57, 60, 64, 67, 72], [50, 53, 57, 60, 64], [48, 52, 55, 59, 64]];
	const bass = [41, 45, 38, 36];
	const drumsIn = bar * 2, drumsOut = len - bar;

	// pad: detuned saws through a one-pole low-pass, chord changes every bar
	let lpL = 0, lpR = 0;
	const ph: number[] = new Array(10).fill(0);
	for (let i = 0; i < n; i++) {
		const t = i / SR, c = chords[Math.floor(t / bar) % 4];
		let sl = 0, sr = 0;
		c.forEach((m, k) => {
			for (const [j, det] of [[0, -0.07], [1, 0.07]] as const) {
				const idx = k * 2 + j;
				ph[idx] = (ph[idx] + mtof(m + det) / SR) % 1;
				if (j === 0) sl += ph[idx] * 2 - 1; else sr += ph[idx] * 2 - 1;
			}
		});
		const cut = 0.035 + 0.02 * Math.sin(t * 0.4);
		lpL += cut * (sl - lpL); lpR += cut * (sr - lpR);
		const fade = Math.min(1, t / 1.5) * Math.min(1, (len - t) / 2);
		L[i] += lpL * 0.05 * fade; R[i] += lpR * 0.05 * fade;
	}

	const add = (start: number, dur: number, f: (t: number) => number, gain: number, pan = 0) => {
		const s0 = Math.floor(start * SR), m = Math.floor(dur * SR);
		for (let i = 0; i < m && s0 + i < n; i++) {
			const fade = Math.min(1, (len - (s0 + i) / SR) / 2), v = f(i / SR) * gain * fade;
			L[s0 + i] += v * (1 - pan); R[s0 + i] += v * (1 + pan);
		}
	};
	for (let b = 0; b * beat < len; b++) {
		const t = b * beat, c = chords[Math.floor(t / bar) % 4];
		// soft electric-piano pluck, 8th-note arpeggio
		for (const h of [0, 0.5]) {
			const f = mtof(c[(b * 2 + (h ? 1 : 0)) % c.length] + 12);
			add(t + h * beat, 0.9, (x) => Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 5) * (1 + 0.3 * Math.sin(4 * Math.PI * f * x)), 0.05, h ? 0.3 : -0.3);
		}
		if (b % 4 === 0) add(t, bar, (x) => Math.sin(2 * Math.PI * mtof(bass[Math.floor(t / bar) % 4]) * x) * Math.min(1, x * 40) * Math.exp(-x * 0.9), 0.16);
		if (t < drumsIn || t >= drumsOut) continue;
		if (b % 2 === 0) add(t, 0.35, (x) => Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 9), 0.38);
		if (b % 4 === 1 || b % 4 === 3) add(t, 0.25, (x) => rnd() * Math.exp(-x * 22) * 0.6 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 25) * 0.4, 0.13);
		for (const h of [0, 0.5]) add(t + h * beat, 0.05, (x) => rnd() * Math.exp(-x * 90), h ? 0.035 : 0.05, 0.4);
	}
	return [L, R];
}

const ts = (s: number) => {
	const ms = Math.round(s * 1000), p = (x: number, k = 2) => String(x).padStart(k, "0");
	return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** Speaks the scenes' lines, mixes them over the music, and returns the paths of out/mix.wav and out/film.srt. */
export function soundtrack(scenes: Scene[], duration: number, out: string) {
	const voDir = join(out, "vo");
	mkdirSync(voDir, { recursive: true });
	const n = Math.ceil(duration * SR), L = new Float32Array(n), R = new Float32Array(n), voiceOn = new Float32Array(n);
	const lines = scenes.flatMap((s, i) => (s.vo ? [{ i, text: s.vo, t: s.start + (s.voAt ?? 0.3) }] : []));
	const srt: string[] = [];
	for (const [k, line] of lines.entries()) {
		const path = join(voDir, `${line.i}.wav`);
		speak(line.text, path);
		const [a] = readWav(path);
		// a line must finish before the next one starts (or the film ends): a slower voice would talk over itself
		const end = line.t + a.length / SR, next = lines[k + 1]?.t ?? duration;
		if (end > next) throw new Error(`"${line.text}" ends at ${end.toFixed(2)}s, after ${next.toFixed(2)}s; shorten it or speed it up (RATE)`);
		const s0 = Math.round(line.t * SR);
		for (let i = 0; i < a.length && s0 + i < n; i++) { L[s0 + i] += a[i]; R[s0 + i] += a[i]; voiceOn[s0 + i] = 1; }
		srt.push(`${k + 1}\n${ts(line.t)} --> ${ts(end)}\n${line.text}\n`);
	}

	// music, ducked under the voice: smooth the voice envelope (fast attack, slow release)
	const [mL, mR] = music(duration);
	let env = 0;
	for (let i = 0; i < n; i++) {
		env += (voiceOn[i] - env) * (voiceOn[i] > env ? 1 / (0.08 * SR) : 1 / (0.6 * SR));
		const g = 0.55 * (1 - 0.6 * env);
		L[i] += mL[i] * g; R[i] += mR[i] * g;
	}

	const mix = join(out, "mix.wav"), subs = join(out, "film.srt");
	writeWav(mix, L, R);
	writeFileSync(subs, srt.join("\n"));
	console.log("soundtrack", duration.toFixed(2), "s,", lines.length, "voice lines");
	return { mix, srt: subs };
}
