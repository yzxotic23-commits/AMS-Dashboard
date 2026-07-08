import { z } from 'zod';

const IP_STATUSES = ['ACTIVE', 'INACTIVE', 'FLAGGED', 'RETIRED'];

export const ipImportRowSchema = z.object({
  proxy_provider: z.string().optional().nullable(),
  proxy_type: z.string().optional().nullable(),
  ip_address: z.string().min(1),
  port: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  status: z.enum(IP_STATUSES).optional(),
  notes: z.string().optional().nullable(),
});

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

export function mapIpImportRow(raw) {
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

export function parseIpCsv(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return { rows: [], errors: [{ line: 1, message: 'File is empty' }] };
  }

  const lines = normalized.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    return { rows: [], errors: [{ line: 1, message: 'CSV must include a header row and at least one data row' }] };
  }

  const headers = parseCsvLine(lines[0]);
  const fieldIndexes = headers.map((header) => resolveField(header));
  if (!fieldIndexes.includes('ip_address')) {
    return { rows: [], errors: [{ line: 1, message: 'Missing required column: ip_address' }] };
  }

  const rows = [];
  const errors = [];

  for (let i = 1; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]);
    if (cells.every((cell) => cell === '')) continue;

    const raw = {};
    fieldIndexes.forEach((field, index) => {
      if (!field) return;
      raw[field] = cells[index] ?? '';
    });

    const mapped = mapIpImportRow(raw);
    if (!mapped.ip_address) {
      errors.push({ line: lineNo, message: 'ip_address is required' });
      continue;
    }

    try {
      rows.push(ipImportRowSchema.parse(mapped));
    } catch (e) {
      const message = e.errors?.[0]?.message || 'Invalid row';
      errors.push({ line: lineNo, message, ip_address: mapped.ip_address });
    }
  }

  return { rows, errors };
}

export function dedupeImportRows(rows, existingAddresses = new Set()) {
  const seen = new Set(existingAddresses);
  const unique = [];
  const skipped = [];

  rows.forEach((row) => {
    const key = row.ip_address.trim().toLowerCase();
    if (seen.has(key)) {
      skipped.push({ ip_address: row.ip_address, reason: 'duplicate' });
      return;
    }
    seen.add(key);
    unique.push(mapIpImportRow(row));
  });

  return { unique, skipped };
}

export const IP_IMPORT_TEMPLATE = `proxy_provider,ip_address,port,username,password,country,proxy_type,status
IP 001,64.16.184.120,1081,user01,pass01,KH,SOCKS5,ACTIVE
IP 002,64.16.184.121,1081,user02,pass02,KH,SOCKS5,ACTIVE`;
