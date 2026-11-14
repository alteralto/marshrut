'use strict';
// Upload form: reading the multipart body and checking the optional source link.

const maxBatch = 80 * 1024 * 1024;

async function readForm(req) {
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data;/i.test(type)) throw new Error('Выберите файлы через форму загрузки.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // past the limit the request is drained without keeping the bytes, so the client still gets the error
    if (size <= maxBatch) chunks.push(chunk);
  }
  if (size > maxBatch) throw new Error('Размер одной пачки ограничен 80 МБ.');
  return new Response(Buffer.concat(chunks), { headers: { 'content-type': type } }).formData();
}

// Link to where the document is published; allowed for one file at a time.
function sourceUrl(form, fileCount) {
  const external = String(form.get('source') || '').trim();
  if (!external) return null;
  if (fileCount !== 1) throw new Error('URL можно привязать к одному файлу за раз.');
  try {
    const parsed = new URL(external);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch {
    throw new Error('Введите ссылку HTTP или HTTPS.');
  }
}

module.exports = { readForm, sourceUrl };
