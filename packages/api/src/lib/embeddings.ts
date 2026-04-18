import { env } from "@g-spot/env/server";

const OLLAMA_BASE_URL = env.OLLAMA_BASE_URL;
const EMBEDDING_MODEL = env.EMBEDDING_MODEL;
const EMBEDDING_DIM = 768;

export { EMBEDDING_DIM };

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

/**
 * Generate embeddings for one or more texts via Ollama.
 * Uses the /api/embed endpoint which supports batching.
 */
export async function embed(input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embed failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as OllamaEmbedResponse;
  return data.embeddings;
}

/**
 * Generate a single embedding vector. Convenience wrapper around `embed`.
 */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed(text);
  if (!vec) throw new Error("Ollama returned no embedding");
  return vec;
}

/**
 * Convert a number[] embedding to a Float32Array suitable for sqlite-vector.
 */
export function toF32Buffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer);
}

/**
 * Convert a sqlite-vector BLOB back to number[].
 */
export function fromF32Buffer(buf: Buffer | ArrayBuffer): number[] {
  if (buf instanceof Buffer) {
    const copy = new ArrayBuffer(buf.byteLength);
    const view = new Uint8Array(copy);
    view.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    return Array.from(new Float32Array(copy));
  }
  return Array.from(new Float32Array(buf));
}
