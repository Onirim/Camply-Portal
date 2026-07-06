import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.RESTORE_TARGET_SUPABASE_URL;
const serviceRoleKey = process.env.RESTORE_TARGET_SERVICE_ROLE_KEY;
const rootDir = process.argv[2] ?? 'storage_backup';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('RESTORE_TARGET_SUPABASE_URL et RESTORE_TARGET_SERVICE_ROLE_KEY doivent être définis.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  const bucketEntries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const bucketEntry of bucketEntries) {
    if (!bucketEntry.isDirectory()) continue;
    const bucket = bucketEntry.name;
    const bucketDir = path.join(rootDir, bucket);
    const files = await walk(bucketDir);
    console.log(`Bucket ${bucket} : ${files.length} fichier(s) à envoyer`);
    for (const filePath of files) {
      const objectPath = path.relative(bucketDir, filePath).split(path.sep).join('/');
      const content = await fs.readFile(filePath);
      const { error } = await supabase.storage.from(bucket).upload(objectPath, content, { upsert: true });
      if (error) {
        console.error(`  ! échec upload ${bucket}/${objectPath}:`, error.message);
        continue;
      }
      console.log(`  ok ${bucket}/${objectPath}`);
    }
  }
  console.log('Restauration du Storage terminée.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
