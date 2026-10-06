import { supabase } from './supabase';
import type { RecordType } from './types';

/** Upload a docket/invoice photo to storage and create its document row. Online only. */
export async function uploadDocument(file: File, farmId: string, recordType: RecordType, confirmed: boolean): Promise<string> {
  const docId = crypto.randomUUID();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${farmId}/${docId}.${ext}`;
  const up = await supabase.storage.from('records').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
  const { error } = await supabase.from('documents').insert({
    id: docId, farm_id: farmId, record_type: recordType, storage_path: path, file_name: file.name, mime_type: file.type,
    state: confirmed ? 'confirmed' : 'unconfirmed'
  });
  if (error) throw new Error(error.message);
  return docId;
}

export async function documentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('records').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
