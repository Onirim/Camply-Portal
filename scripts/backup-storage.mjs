import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const OUTPUT_DIR = 'storage_backup';

async function listAllEntries(bucket, prefix) {
  const entries = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    entries.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return entries;
}

async function downloadBucket(bucket) {
  const stack = [''];
  while (stack.length) {
    const prefix = stack.pop();
    const entries = await listAllEntries(bucket, prefix);
    for (const entry of entries) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder = entry.id === null;
      if (isFolder) {
        stack.push(fullPath);
        continue;
      }
      const { data, error } = await supabase.storage.from(bucket).download(fullPath);
      if (error) {
        console.error(`  ! échec du téléchargement ${bucket}/${fullPath}:`, error.message);
        continue;
      }
      const destPath = path.join(OUTPUT_DIR, bucket, fullPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, Buffer.from(await data.arrayBuffer()));
      console.log(`  ok ${bucket}/${fullPath}`);
    }
  }
}

async function main() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  console.log(`${buckets.length} bucket(s) trouvé(s).`);
  for (const bucket of buckets) {
    console.log(`Sauvegarde du bucket : ${bucket.name}`);
    await downloadBucket(bucket.name);
  }
  console.log('Sauvegarde du Storage terminée.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
