import { env } from "@g-spot/env/web";
import { stackClientApp } from "@/stack/client";

export interface UploadedFile {
  fileId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Upload a single file to the server. Returns metadata including the server URL. */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const user = await stackClientApp.getUser();
  if (!user) throw new Error("Not authenticated");
  const { accessToken } = await user.getAuthJson();
  if (!accessToken) throw new Error("No access token");

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${env.VITE_SERVER_URL}/api/files/upload`, {
    method: "POST",
    headers: { "x-stack-access-token": accessToken },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${text}`);
  }

  const data = (await res.json()) as UploadedFile;
  // Convert relative path to absolute URL
  data.url = `${env.VITE_SERVER_URL}${data.url}`;
  return data;
}
