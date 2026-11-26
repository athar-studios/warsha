import { invoke } from '@tauri-apps/api/core';

export type FolderPickerResult =
  | { status: 'selected'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function pickProjectFolder(title?: string): Promise<FolderPickerResult> {
  if (!isTauriRuntime()) {
    return { status: 'unavailable' };
  }
  const picked = await invoke<string | null>('pick_folder', { title });
  if (typeof picked === 'string' && picked.trim().length > 0) {
    return { status: 'selected', path: picked };
  }
  return { status: 'cancelled' };
}
