import fs from 'node:fs/promises';

const [, , inputPath, publicDataOut, authUsersOut] = process.argv;

if (!inputPath || !publicDataOut || !authUsersOut) {
  console.error('Usage: node extract-data.mjs <db_backup.sql> <restore_public_data.sql> <restore_auth_users.sql>');
  process.exit(1);
}

const lines = (await fs.readFile(inputPath, 'utf8')).split('\n');
const headerRegex = /^-- Data for Name: (.+); Type: TABLE DATA; Schema: (.+); Owner: .+$/;

const blocks = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === '--') {
    const m = (lines[i + 1] ?? '').match(headerRegex);
    if (m) blocks.push({ line: i, name: m[1].trim(), schema: m[2].trim() });
  }
}

function extractChunk(startLine) {
  const idx = blocks.findIndex((b) => b.line === startLine);
  const end = idx + 1 < blocks.length ? blocks[idx + 1].line : lines.length;
  return lines.slice(startLine, end).join('\n').trimEnd();
}

// Désactive triggers ET contraintes FK pendant le chargement, pour pouvoir
// réinjecter auth.users et les tables public dans n'importe quel ordre
// sans déclencher la logique métier (triggers) une seconde fois.
const disableGuards = 'SET session_replication_role = replica;';
const restoreGuards = 'SET session_replication_role = DEFAULT;';

// TRUNCATE avant chaque COPY : 00_fresh_install.sql sème des lignes en dur dans
// certaines tables (public.site_info, public.admin_users, …). Sans ce vidage, le
// COPY du dump réinjecterait les mêmes clés primaires -> "duplicate key" et, sous
// ON_ERROR_STOP=1, l'étape de restore avorte. On vide donc chaque table cible
// juste avant de la recharger, ce qui rend le restore idempotent face à tout
// seed présent ou futur. RESTART IDENTITY réinitialise les séquences éventuelles.
const truncate = (name) => `TRUNCATE TABLE public."${name}" RESTART IDENTITY CASCADE;`;

// On vide TOUTES les tables publiques en tête de fichier (avant tout COPY), afin
// qu'un TRUNCATE ... CASCADE tardif ne puisse jamais purger une table déjà
// rechargée plus haut. Les tables sans données (donc absentes du dump) sont de
// toute façon vides sur une base neuve : les ignorer est sans effet.
const publicBlocks = blocks.filter((b) => b.schema === 'public');
const publicTruncates = publicBlocks.map((b) => truncate(b.name));
const publicChunks = publicBlocks.map((b) => extractChunk(b.line));
const authUsersBlock = blocks.find((b) => b.schema === 'auth' && b.name === 'users');

await fs.writeFile(
  publicDataOut,
  [disableGuards, ...publicTruncates, ...publicChunks, restoreGuards].join('\n\n') + '\n'
);

await fs.writeFile(
  authUsersOut,
  authUsersBlock
    ? [disableGuards, extractChunk(authUsersBlock.line), restoreGuards].join('\n\n') + '\n'
    : '-- Aucune donnée auth.users trouvée dans ce dump.\n'
);

console.log(`${publicChunks.length} table(s) publiques extraites -> ${publicDataOut}`);
console.log(authUsersBlock ? `auth.users extrait -> ${authUsersOut}` : 'auth.users absent du dump.');
