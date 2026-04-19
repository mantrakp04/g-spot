import { pipeline } from "@huggingface/transformers";
import { env } from "@g-spot/env/server";

const EMBEDDING_MODEL = env.EMBEDDING_MODEL;
const EMBEDDING_DIM = 768;
const EMBEDDING_DTYPE = "q8";
const QUERY_PREFIX = "task: search result | query: ";
const DOCUMENT_PREFIX = "title: none | text: ";

type EmbeddingPurpose = "document" | "query";

interface EmbeddingTensor {
  data: ArrayLike<number>;
  dims: number[];
}

let extractorPromise: Promise<any> | undefined;

export { EMBEDDING_DIM };

async function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: EMBEDDING_DTYPE,
  });
  return extractorPromise;
}

function withPrefix(text: string, purpose: EmbeddingPurpose): string {
  return `${purpose === "query" ? QUERY_PREFIX : DOCUMENT_PREFIX}${text}`;
}

function tensorToEmbeddings(tensor: EmbeddingTensor, expectedRows: number): number[][] {
  if (tensor.dims.length !== 2) {
    throw new Error(
      `Unexpected embedding tensor rank ${tensor.dims.length}; expected 2D pooled embeddings`,
    );
  }

  const [rows, cols] = tensor.dims;
  if (rows !== expectedRows) {
    throw new Error(`Expected ${expectedRows} embeddings, received ${rows}`);
  }
  if (cols !== EMBEDDING_DIM) {
    throw new Error(`Expected embedding dim ${EMBEDDING_DIM}, received ${cols}`);
  }

  const flat = Array.from(tensor.data);
  const embeddings: number[][] = [];

  for (let row = 0; row < rows; row++) {
    const start = row * cols;
    embeddings.push(flat.slice(start, start + cols));
  }

  return embeddings;
}

/**
 * Generate embeddings for one or more texts via Transformers.js.
 */
export async function embed(
  input: string | string[],
  purpose: EmbeddingPurpose = "document",
): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const prepared = texts.map((text) => withPrefix(text, purpose));
  const tensor = (await extractor(prepared, {
    pooling: "mean",
    normalize: true,
  })) as EmbeddingTensor;

  return tensorToEmbeddings(tensor, texts.length);
}

/**
 * Generate a single embedding vector. Convenience wrapper around `embed`.
 */
export async function embedOne(
  text: string,
  purpose: EmbeddingPurpose = "document",
): Promise<number[]> {
  const [vec] = await embed(text, purpose);
  if (!vec) throw new Error("Embedding model returned no embedding");
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
