const HEADER_ALIASES = {
  proxy_provider: ['proxy_provider', 'source', 'provider', 'label'],
  ip_address: ['ip_address', 'ip', 'address'],
  port: ['port'],
  username: ['username', 'user'],
  password: ['password', 'pass'],
  country: ['country'],
  proxy_type: ['proxy_type', 'type'],
  status: ['status'],
  notes: ['notes'],
};

const IP_STATUSES = ['ACTIVE', 'INACTIVE', 'FLAGGED', 'RETIRED'];

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function resolveField(header) {
  const key = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  out.push(current.trim());
  return out;
}

function cleanCell(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeStatus(value) {
  const status = String(value || 'ACTIVE').trim().toUpperCase();
  return IP_STATUSES.includes(status) ? status : null;
}

function mapRow(raw) {
  const status = raw.status ? normalizeStatus(raw.status) : 'ACTIVE';
  return {
    proxy_provider: cleanCell(raw.proxy_provider),
    proxy_type: cleanCell(raw.proxy_type),
    ip_address: String(raw.ip_address || '').trim(),
    port: cleanCell(raw.port),
    username: cleanCell(raw.username),
    password: raw.password == null || raw.password === '' ? null : String(raw.password),
    country: cleanCell(raw.country),
    status: status || 'ACTIVE',
    notes: cleanCell(raw.notes),
  };
}

export function parseIpCsvPreview(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return { validCount: 0, errors: [{ line: 1, message: 'File is empty' }], sample: [] };
  }

  const lines = normalized.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    return {
      validCount: 0,
      errors: [{ line: 1, message: 'CSV must include a header row and at least one data row' }],
      sample: [],
    };
  }

  const headers = parseCsvLine(lines[0]);
  const fieldIndexes = headers.map((header) => resolveField(header));
  if (!fieldIndexes.includes('ip_address')) {
    return {
      validCount: 0,
      errors: [{ line: 1, message: 'Missing required column: ip_address' }],
      sample: [],
    };
  }

  const errors = [];
  const sample = [];
  let validCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]);
    if (cells.every((cell) => cell === '')) continue;

    const raw = {};
    fieldIndexes.forEach((field, index) => {
      if (!field) return;
      raw[field] = cells[index] ?? '';
    });

    const mapped = mapRow(raw);
    if (!mapped.ip_address) {
      errors.push({ line: lineNo, message: 'ip_address is required' });
      continue;
    }
    if (!mapped.status) {
      errors.push({ line: lineNo, message: 'Invalid status', ip_address: mapped.ip_address });
      continue;
    }

    validCount += 1;
    if (sample.length < 3) sample.push(mapped);
  }

  return { validCount, errors, sample };
}

export const IP_IMPORT_TEMPLATE = `proxy_provider,ip_address,port,username,password,country,proxy_type,status
IP 001,64.16.184.120,1081,user01,pass01,KH,SOCKS5,ACTIVE
IP 002,64.16.184.121,1081,user02,pass02,KH,SOCKS5,ACTIVE`;

export function downloadIpImportTemplate() {
  const blob = new Blob([IP_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ip-import-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}
