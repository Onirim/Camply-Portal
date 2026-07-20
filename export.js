// ══════════════════════════════════════════════════════════════
// Camply — Export des objets visibles (propriétés + abonnements)
// ══════════════════════════════════════════════════════════════

function _safeName(value, fallback = 'objet') {
  const v = String(value || '').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\-. ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return v || fallback;
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _extractMarkdownImageUrls(md = '') {
  const urls = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (m[1]) urls.push(m[1]);
  }
  return urls;
}

async function _fetchImageBlob(url) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  }
}

function _guessImageExt(url, blob) {
  const fromUrl = (url || '').split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  const mime = blob?.type || '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'bin';
}

function _fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function _slugify(text) {
  const v = String(text || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return v || 'section';
}

function _tagsForChar(c) {
  const map = charTagMap || {};
  return (map[c._db_id] || []).map(id => (allTags || []).find(tg => tg.id === id)).filter(Boolean);
}

function _tagsForDoc(d) {
  const map = docTagMap || {};
  return (map[d.id] || []).map(id => (allDocTags || []).find(tg => tg.id === id)).filter(Boolean);
}

function _buildTagIndex(model) {
  const bySlug = {};
  function add(name, kind, obj) {
    if (!name) return;
    const slug = _slugify(name);
    if (!bySlug[slug]) bySlug[slug] = { name, chars: [], docs: [] };
    bySlug[slug][kind].push(obj);
  }
  model.allChars.forEach(c => _tagsForChar(c).forEach(tg => add(tg.name, 'chars', c)));
  model.allDocs.forEach(d => _tagsForDoc(d).forEach(tg => add(tg.name, 'docs', d)));
  return bySlug;
}

function _renderObjectMarkdown(obj) {
  const lines = [];
  function walk(value, depth = 2, key = null) {
    const prefix = '#'.repeat(Math.min(depth, 6));
    if (key !== null) lines.push(`${prefix} ${key}`);

    if (value === null || value === undefined || value === '') {
      lines.push('');
      return;
    }

    if (Array.isArray(value)) {
      if (!value.length) {
        lines.push('- (vide)', '');
        return;
      }
      value.forEach((item, idx) => {
        if (item && typeof item === 'object') {
          lines.push(`- Élément ${idx + 1}`);
          Object.entries(item).forEach(([k, v]) => walk(v, Math.min(depth + 1, 6), k));
        } else {
          lines.push(`- ${String(item)}`);
        }
      });
      lines.push('');
      return;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) {
        lines.push('- (vide)', '');
        return;
      }
      entries.forEach(([k, v]) => walk(v, Math.min(depth + 1, 6), k));
      lines.push('');
      return;
    }

    lines.push(String(value), '');
  }

  Object.entries(obj || {}).forEach(([k, v]) => {
    if (k.startsWith('_')) return;
    walk(v, 2, k);
  });

  return lines.join('\n').trim() + '\n';
}

async function _appendImages(zipFolder, urls = []) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (!unique.length) return 0;

  const imgFolder = zipFolder.folder('images');
  let added = 0;
  for (let i = 0; i < unique.length; i += 1) {
    const url = unique[i];
    const blob = await _fetchImageBlob(url);
    if (!blob) continue;
    const ext = _guessImageExt(url, blob);
    imgFolder.file(`image_${String(i + 1).padStart(2, '0')}.${ext}`, blob);
    added += 1;
  }
  return added;
}

async function _collectChronicleEntries(chronicleIds) {
  if (!chronicleIds.length) return [];
  const { data, error } = await sb.from('chronicle_entries')
    .select('id, chronicle_id, title, content, created_at, updated_at')
    .in('chronicle_id', chronicleIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message || 'Erreur de chargement des entrées de chronique');
  return data || [];
}

async function _collectOwnMapMarkers() {
  const { data, error } = await sb.from('map_markers')
    .select('id, x, y, name, description, color, map_key')
    .eq('user_id', currentUser.id)
    .eq('universe_id', currentUniverse.id);
  if (error) throw new Error(error.message || 'Erreur de chargement des marqueurs de carte');
  return data || [];
}

async function _gatherExportModel() {
  const allChars = [
    ...Object.values(chars || {}).map(c => ({ ...c, _source: 'owned' })),
    ...Object.values(followedChars || {}).map(c => ({ ...c, _source: 'followed' })),
  ];

  const allChronicles = [
    ...Object.values(chronicles || {}).map(c => ({ ...c, _source: 'owned' })),
    ...Object.values(followedChronicles || {}).map(c => ({ ...c, _source: 'followed' })),
  ];
  const chrIds = allChronicles.map(c => c.id).filter(Boolean);
  const allEntries = await _collectChronicleEntries(chrIds);
  const entriesByChronicle = {};
  allEntries.forEach(e => {
    if (!entriesByChronicle[e.chronicle_id]) entriesByChronicle[e.chronicle_id] = [];
    entriesByChronicle[e.chronicle_id].push(e);
  });

  const allDocs = [
    ...Object.values(documents || {}).map(d => ({ ...d, _source: 'owned' })),
    ...Object.values(followedDocuments || {}).map(d => ({ ...d, _source: 'followed' })),
  ];

  const ownMarkers = await _collectOwnMapMarkers();
  const ownLayers = Object.values(mapOwnLayers || {}).map(layer => ({
    layer,
    markers: ownMarkers.filter(m => _normalizeMapKey(m.map_key) === _normalizeMapKey(layer.map_key)),
    source: 'owned'
  }));
  const followedLayers = Object.values(mapFollowedLayers || {}).map(({ layer, markers }) => ({
    layer,
    markers: Object.values(markers || {}).filter(m => _normalizeMapKey(m.map_key) === _normalizeMapKey(layer.map_key)),
    source: 'followed'
  }));

  return {
    allChars,
    allChronicles,
    entriesByChronicle,
    allDocs,
    mapItems: [...ownLayers, ...followedLayers],
  };
}

async function _buildFullZip(model) {
  const zip = new JSZip();
  const root = zip.folder(`camply_export_${new Date().toISOString().slice(0, 10)}`);

  const personnages = root.folder('personnages');
  const chroniquesDir = root.folder('chroniques');
  const documentsDir = root.folder('documents');
  const cartesDir = root.folder('cartes');

  for (const c of model.allChars) {
    const name = _safeName(c.name, 'personnage');
    const objDir = personnages.folder(`${name}_${c._db_id || ''}`);
    objDir.file('personnage.md', `# ${c.name || 'Personnage'}\n\n${_renderObjectMarkdown(c)}`);
    await _appendImages(objDir, [c.illustration_url]);
  }

  for (const chr of model.allChronicles) {
    const name = _safeName(chr.title, 'chronique');
    const objDir = chroniquesDir.folder(`${name}_${chr.id || ''}`);
    const head = [
      `# ${chr.title || 'Chronique'}`,
      '',
      chr.description || '',
      '',
      `- Source: ${chr._source === 'owned' ? 'propriétaire' : 'abonné'}`,
      `- Dernière mise à jour: ${_fmtDate(chr.updated_at)}`,
      ''
    ].join('\n');
    objDir.file('README.md', head);

    const entries = model.entriesByChronicle[chr.id] || [];
    entries.forEach((e, index) => {
      const file = `${String(index + 1).padStart(3, '0')}_${_safeName(e.title, 'entree')}.md`;
      objDir.file(file, `# ${e.title || 'Entrée'}\n\n${e.content || ''}\n`);
    });

    const imageUrls = [chr.illustration_url];
    entries.forEach(e => imageUrls.push(..._extractMarkdownImageUrls(e.content || '')));
    await _appendImages(objDir, imageUrls);
  }

  for (const d of model.allDocs) {
    const name = _safeName(d.title, 'document');
    const objDir = documentsDir.folder(`${name}_${d.id || ''}`);
    const md = [
      `# ${d.title || 'Document'}`,
      '',
      `- Source: ${d._source === 'owned' ? 'propriétaire' : 'abonné'}`,
      `- Dernière mise à jour: ${_fmtDate(d.updated_at)}`,
      '',
      d.content || '',
      ''
    ].join('\n');
    objDir.file('document.md', md);
    await _appendImages(objDir, [d.illustration_url, ..._extractMarkdownImageUrls(d.content || '')]);
  }

  for (const item of model.mapItems) {
    const layer = item.layer || {};
    const mapLabel = (mapsConfig || []).find(m => m.key === layer.map_key)?.name || layer.map_key || 'default';
    const name = _safeName(mapLabel, 'carte');
    const objDir = cartesDir.folder(`${name}_${layer.id || ''}`);
    const lines = [
      `# ${mapLabel}`,
      '',
      `- Source: ${item.source === 'owned' ? 'propriétaire' : 'abonné'}`,
      ...(layer._owner_name ? [`- Propriétaire: ${layer._owner_name}`] : []),
      '',
      '## Marqueurs',
      ''
    ];
    if (!item.markers.length) {
      lines.push('- (aucun marqueur)', '');
    } else {
      item.markers.forEach((m, idx) => {
        lines.push(`### ${idx + 1}. ${m.name || 'Sans nom'}`);
        lines.push(`- Position: x=${m.x}, y=${m.y}`);
        lines.push(`- Couleur: ${m.color || '—'}`);
        lines.push('');
        if (m.description) lines.push(m.description, '');
      });
    }
    objDir.file(`couche_${_safeName(layer.map_key || 'default')}.md`, lines.join('\n'));
  }

  root.file('README.md', [
    '# Export Camply',
    '',
    `Date: ${new Date().toISOString()}`,
    '',
    '- Contient les objets visibles : propriétaires + abonnements.',
    '- Dossiers de catégories : personnages, chroniques, documents, cartes.',
    ''
  ].join('\n'));

  return zip;
}

function _buildMarkdownZip(model) {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().slice(0, 10);
  const root = zip.folder(`camply_export_markdown_${dateStr}`);

  const personnages = root.folder('personnages');
  const chroniquesDir = root.folder('chroniques');
  const documentsDir = root.folder('documents');
  const cartesDir = root.folder('cartes');
  const tagsDir = root.folder('tags');
  const tagIndex = _buildTagIndex(model);

  const index = [
    `# Export Camply — ${currentUniverse?.name || 'Univers'}`,
    '',
    `Date: ${new Date().toISOString()}`,
    '',
    '> Export Markdown généré pour être utilisé avec une IA (préparation de scénarios).',
    ''
  ];

  if (model.allChars.length) {
    index.push('## Personnages', '');
    for (const c of model.allChars) {
      const name = _safeName(c.name, 'personnage');
      const file = `${name}_${c._db_id || ''}.md`;
      const tags = _tagsForChar(c);
      const lines = [
        `# ${c.name || 'Personnage'}`,
        '',
        `- Source: ${c._source === 'owned' ? 'propriétaire' : 'abonné'}`,
      ];
      if (tags.length) {
        lines.push(`- Tags: ${tags.map(tg => `[${tg.name}](../tags/${_slugify(tg.name)}.md)`).join(', ')}`);
      }
      lines.push('', _renderObjectMarkdown(c));
      personnages.file(file, lines.join('\n'));
      index.push(`- [${c.name || 'Sans nom'}](personnages/${file})`);
    }
    index.push('');
  }

  if (model.allChronicles.length) {
    index.push('## Chroniques', '');
    for (const chr of model.allChronicles) {
      const name = _safeName(chr.title, 'chronique');
      const dirName = `${name}_${chr.id || ''}`;
      const objDir = chroniquesDir.folder(dirName);
      const entries = model.entriesByChronicle[chr.id] || [];
      const entryFiles = entries.map((e, idx) => ({
        file: `${String(idx + 1).padStart(3, '0')}_${_safeName(e.title, 'entree')}.md`,
        entry: e,
      }));

      const readme = [
        `# ${chr.title || 'Chronique'}`,
        '',
        chr.description || '',
        '',
        `- Source: ${chr._source === 'owned' ? 'propriétaire' : 'abonné'}`,
        `- Dernière mise à jour: ${_fmtDate(chr.updated_at)}`,
        '',
        '## Entrées',
        ''
      ];
      entryFiles.forEach(ef => readme.push(`- [${ef.entry.title || 'Entrée'}](${ef.file})`));
      objDir.file('README.md', readme.join('\n'));

      entryFiles.forEach(ef => {
        objDir.file(ef.file, [
          `# ${ef.entry.title || 'Entrée'}`,
          '',
          '[← Retour à la chronique](README.md)',
          '',
          ef.entry.content || '',
          ''
        ].join('\n'));
      });

      index.push(`- [${chr.title || 'Sans titre'}](chroniques/${dirName}/README.md)`);
    }
    index.push('');
  }

  if (model.allDocs.length) {
    index.push('## Documents', '');
    for (const d of model.allDocs) {
      const name = _safeName(d.title, 'document');
      const file = `${name}_${d.id || ''}.md`;
      const tags = _tagsForDoc(d);
      const lines = [
        `# ${d.title || 'Document'}`,
        '',
        `- Source: ${d._source === 'owned' ? 'propriétaire' : 'abonné'}`,
        `- Dernière mise à jour: ${_fmtDate(d.updated_at)}`,
      ];
      if (tags.length) {
        lines.push(`- Tags: ${tags.map(tg => `[${tg.name}](../tags/${_slugify(tg.name)}.md)`).join(', ')}`);
      }
      lines.push('', d.content || '', '');
      documentsDir.file(file, lines.join('\n'));
      index.push(`- [${d.title || 'Sans titre'}](documents/${file})`);
    }
    index.push('');
  }

  if (model.mapItems.length) {
    index.push('## Cartes', '');
    for (const item of model.mapItems) {
      const layer = item.layer || {};
      const mapLabel = (mapsConfig || []).find(m => m.key === layer.map_key)?.name || layer.map_key || 'default';
      const name = _safeName(mapLabel, 'carte');
      const file = `${name}_${layer.id || ''}.md`;
      const lines = [
        `# ${mapLabel}`,
        '',
        `- Source: ${item.source === 'owned' ? 'propriétaire' : 'abonné'}`,
        ...(layer._owner_name ? [`- Propriétaire: ${layer._owner_name}`] : []),
        '',
        '## Marqueurs',
        ''
      ];
      if (!item.markers.length) {
        lines.push('- (aucun marqueur)', '');
      } else {
        item.markers.forEach((m, idx) => {
          lines.push(`### ${idx + 1}. ${m.name || 'Sans nom'}`);
          lines.push(`- Position: x=${m.x}, y=${m.y}`);
          lines.push(`- Couleur: ${m.color || '—'}`);
          lines.push('');
          if (m.description) lines.push(m.description, '');
        });
      }
      cartesDir.file(file, lines.join('\n'));
      index.push(`- [${mapLabel}](cartes/${file})`);
    }
    index.push('');
  }

  const tagSlugs = Object.keys(tagIndex);
  if (tagSlugs.length) {
    index.push('## Tags', '');
    for (const slug of tagSlugs) {
      const bucket = tagIndex[slug];
      const lines = [`# Tag : ${bucket.name}`, ''];
      if (bucket.chars.length) {
        lines.push('## Personnages', '');
        bucket.chars.forEach(c => {
          const name = _safeName(c.name, 'personnage');
          lines.push(`- [${c.name || 'Sans nom'}](../personnages/${name}_${c._db_id || ''}.md)`);
        });
        lines.push('');
      }
      if (bucket.docs.length) {
        lines.push('## Documents', '');
        bucket.docs.forEach(d => {
          const name = _safeName(d.title, 'document');
          lines.push(`- [${d.title || 'Sans titre'}](../documents/${name}_${d.id || ''}.md)`);
        });
        lines.push('');
      }
      tagsDir.file(`${slug}.md`, lines.join('\n'));
      index.push(`- [${bucket.name}](tags/${slug}.md)`);
    }
    index.push('');
  }

  root.file('INDEX.md', index.join('\n'));
  return zip;
}

function _buildMarkdownSingleFile(model) {
  const charLabel = c => `${c.name || 'Personnage'} (perso-${(c._db_id || '').slice(0, 8)})`;
  const chrLabel = chr => `${chr.title || 'Chronique'} (chronique-${(chr.id || '').slice(0, 8)})`;
  const docLabel = d => `${d.title || 'Document'} (doc-${(d.id || '').slice(0, 8)})`;
  const mapName = layer => (mapsConfig || []).find(m => m.key === layer.map_key)?.name || layer.map_key || 'Carte';
  const mapLabel = layer => `${mapName(layer)} (carte-${(layer.id || '').slice(0, 8)})`;
  const tagLabel = name => `${name} (tag)`;

  const tagIndex = _buildTagIndex(model);
  const out = [];

  out.push(`# Export Camply — ${currentUniverse?.name || 'Univers'}`, '', `Date: ${new Date().toISOString()}`, '');
  if (currentUniverse?.description) out.push(currentUniverse.description, '');
  out.push('> Export Markdown généré pour être utilisé avec une IA (préparation de scénarios).', '');

  out.push('## Sommaire', '');
  if (model.allChars.length) {
    out.push('- Personnages');
    model.allChars.forEach(c => out.push(`  - [${c.name || 'Sans nom'}](#${_slugify(charLabel(c))})`));
  }
  if (model.allChronicles.length) {
    out.push('- Chroniques');
    model.allChronicles.forEach(chr => out.push(`  - [${chr.title || 'Sans titre'}](#${_slugify(chrLabel(chr))})`));
  }
  if (model.allDocs.length) {
    out.push('- Documents');
    model.allDocs.forEach(d => out.push(`  - [${d.title || 'Sans titre'}](#${_slugify(docLabel(d))})`));
  }
  if (model.mapItems.length) {
    out.push('- Cartes');
    model.mapItems.forEach(item => out.push(`  - [${mapName(item.layer || {})}](#${_slugify(mapLabel(item.layer || {}))})`));
  }
  const tagSlugs = Object.keys(tagIndex);
  if (tagSlugs.length) {
    out.push('- Tags');
    tagSlugs.forEach(slug => out.push(`  - [${tagIndex[slug].name}](#${_slugify(tagLabel(tagIndex[slug].name))})`));
  }
  out.push('');

  if (model.allChars.length) {
    out.push('## Personnages', '');
    model.allChars.forEach(c => {
      out.push(`### ${charLabel(c)}`, '');
      out.push(`- Source: ${c._source === 'owned' ? 'propriétaire' : 'abonné'}`);
      const tags = _tagsForChar(c);
      if (tags.length) {
        out.push(`- Tags: ${tags.map(tg => `[${tg.name}](#${_slugify(tagLabel(tg.name))})`).join(', ')}`);
      }
      out.push('', _renderObjectMarkdown(c));
    });
  }

  if (model.allChronicles.length) {
    out.push('## Chroniques', '');
    model.allChronicles.forEach(chr => {
      out.push(`### ${chrLabel(chr)}`, '');
      out.push(`- Source: ${chr._source === 'owned' ? 'propriétaire' : 'abonné'}`);
      out.push(`- Dernière mise à jour: ${_fmtDate(chr.updated_at)}`, '');
      if (chr.description) out.push(chr.description, '');
      const entries = model.entriesByChronicle[chr.id] || [];
      entries.forEach(e => {
        out.push(`#### ${e.title || 'Entrée'}`, '', e.content || '', '');
      });
    });
  }

  if (model.allDocs.length) {
    out.push('## Documents', '');
    model.allDocs.forEach(d => {
      out.push(`### ${docLabel(d)}`, '');
      out.push(`- Source: ${d._source === 'owned' ? 'propriétaire' : 'abonné'}`);
      out.push(`- Dernière mise à jour: ${_fmtDate(d.updated_at)}`);
      const tags = _tagsForDoc(d);
      if (tags.length) {
        out.push(`- Tags: ${tags.map(tg => `[${tg.name}](#${_slugify(tagLabel(tg.name))})`).join(', ')}`);
      }
      out.push('', d.content || '', '');
    });
  }

  if (model.mapItems.length) {
    out.push('## Cartes', '');
    model.mapItems.forEach(item => {
      const layer = item.layer || {};
      out.push(`### ${mapLabel(layer)}`, '');
      out.push(`- Source: ${item.source === 'owned' ? 'propriétaire' : 'abonné'}`);
      if (layer._owner_name) out.push(`- Propriétaire: ${layer._owner_name}`);
      out.push('', '#### Marqueurs', '');
      if (!item.markers.length) {
        out.push('- (aucun marqueur)', '');
      } else {
        item.markers.forEach((m, idx) => {
          out.push(`##### ${idx + 1}. ${m.name || 'Sans nom'}`);
          out.push(`- Position: x=${m.x}, y=${m.y}`);
          out.push(`- Couleur: ${m.color || '—'}`, '');
          if (m.description) out.push(m.description, '');
        });
      }
    });
  }

  if (tagSlugs.length) {
    out.push('## Tags', '');
    tagSlugs.forEach(slug => {
      const bucket = tagIndex[slug];
      out.push(`### ${tagLabel(bucket.name)}`, '');
      if (bucket.chars.length) {
        out.push(`Personnages : ${bucket.chars.map(c => `[${c.name || 'Sans nom'}](#${_slugify(charLabel(c))})`).join(', ')}`, '');
      }
      if (bucket.docs.length) {
        out.push(`Documents : ${bucket.docs.map(d => `[${d.title || 'Sans titre'}](#${_slugify(docLabel(d))})`).join(', ')}`, '');
      }
    });
  }

  return out.join('\n');
}

async function exportVisibleData() {
  if (!window.JSZip) {
    showToast(t('export_error_zip_lib'));
    return;
  }

  try {
    showToast(t('export_in_progress'));
    if (typeof ensureMapLayersCacheLoaded === 'function') {
      await ensureMapLayersCacheLoaded();
    }

    const model = await _gatherExportModel();
    const zip = await _buildFullZip(model);
    const blob = await zip.generateAsync({ type: 'blob' });
    _downloadBlob(blob, `camply_export_${new Date().toISOString().slice(0, 10)}.zip`);
    showToast(t('export_done'));
  } catch (err) {
    console.error(err);
    showToast(`${t('export_error')}: ${err.message || 'inconnue'}`);
  }
}

async function exportMarkdownData(mdMode = 'multi') {
  if (mdMode === 'multi' && !window.JSZip) {
    showToast(t('export_error_zip_lib'));
    return;
  }

  try {
    showToast(t('export_in_progress'));
    if (typeof ensureMapLayersCacheLoaded === 'function') {
      await ensureMapLayersCacheLoaded();
    }

    const model = await _gatherExportModel();
    const dateStr = new Date().toISOString().slice(0, 10);

    if (mdMode === 'single') {
      const md = _buildMarkdownSingleFile(model);
      _downloadBlob(new Blob([md], { type: 'text/markdown' }), `camply_export_${dateStr}.md`);
    } else {
      const zip = _buildMarkdownZip(model);
      const blob = await zip.generateAsync({ type: 'blob' });
      _downloadBlob(blob, `camply_export_markdown_${dateStr}.zip`);
    }
    showToast(t('export_done'));
  } catch (err) {
    console.error(err);
    showToast(`${t('export_error')}: ${err.message || 'inconnue'}`);
  }
}

let _exportFormat = 'zip';
let _exportMdMode = 'single';

function openExportModal() {
  toggleUserMenu(false);
  _exportFormat = 'zip';
  _exportMdMode = 'single';
  _setExportFormat('zip');
  _setExportMdMode('single');
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'flex';
}

function closeExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'none';
}

function _setExportFormat(format) {
  _exportFormat = format;
  document.querySelectorAll('#export-format-grid .export-option-card').forEach(el => {
    el.classList.toggle('active', el.dataset.format === format);
  });
  const mdSection = document.getElementById('export-md-mode-section');
  if (mdSection) mdSection.style.display = format === 'markdown' ? 'block' : 'none';
}

function _setExportMdMode(mode) {
  _exportMdMode = mode;
  document.querySelectorAll('#export-md-mode-grid .export-option-card').forEach(el => {
    el.classList.toggle('active', el.dataset.mdMode === mode);
  });
}

async function confirmExportChoice() {
  closeExportModal();
  if (_exportFormat === 'markdown') {
    await exportMarkdownData(_exportMdMode);
  } else {
    await exportVisibleData();
  }
}
