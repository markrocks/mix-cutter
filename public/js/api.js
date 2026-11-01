async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  info: () => req('GET', '/api/info'),
  bands: () => req('GET', '/api/bands'),
  saveBand: (name) => req('POST', '/api/bands', { name }),
  deleteBand: (name) => req('DELETE', `/api/bands/${encodeURIComponent(name)}`),
  settings: () => req('GET', '/api/settings'),
  saveSettings: (patch) => req('PUT', '/api/settings', patch),
  sessions: () => req('GET', '/api/sessions'),
  session: (id) => req('GET', `/api/sessions/${id}`),
  patchSession: (id, patch) => req('PATCH', `/api/sessions/${id}`, patch),
  peaks: (id) => req('GET', `/api/sessions/${id}/peaks`),
  saveSegments: (id, segments) => req('PUT', `/api/sessions/${id}/segments`, { segments }),
  detect: (id, params) => req('POST', `/api/sessions/${id}/detect`, params),
  cut: (id, upload) => req('POST', `/api/sessions/${id}/cut`, { upload }),
  upload: (id) => req('POST', `/api/sessions/${id}/upload`),
  retry: (id) => req('POST', `/api/sessions/${id}/retry`),
  reveal: (id) => req('POST', `/api/sessions/${id}/reveal`),
  deleteSession: (id) => req('DELETE', `/api/sessions/${id}`),
  disconnectSoundCloud: () => req('POST', '/api/soundcloud/disconnect'),
  shutdown: (force = false) => req('POST', '/api/shutdown', { force }),
};

/** Multipart upload with progress (fetch can't report upload progress). */
export function uploadRecording(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/sessions');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Is the desktop app still running?'));
    xhr.send(formData);
  });
}
