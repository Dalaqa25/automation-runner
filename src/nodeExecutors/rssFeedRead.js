const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * RSS Feed Read Node Executor
 * Fetches and parses RSS/Atom feeds
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};

  // Evaluate URL (may contain expressions like ={{ $json.rssUrl }})
  let url = params.url || '';
  if (url.startsWith('=') || url.includes('{{')) {
    url = evaluateExpression(url, {
      currentInput: inputData,
      executionContext
    });
  }

  if (!url) {
    throw new Error('RSS Feed URL is required');
  }

  console.log(`[RSSFeedRead] Fetching feed: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'ModelGrow-AutomationRunner/1.0',
        'Accept': 'application/rss+xml, application/xml, application/atom+xml, text/xml, */*'
      },
      timeout: 30000,
      responseType: 'text'
    });

    const xml = response.data;
    const items = parseRSSFeed(xml);

    console.log(`[RSSFeedRead] Parsed ${items.length} items from ${url}`);

    if (items.length === 0) {
      return [{ json: { error: 'No items found in feed', url } }];
    }

    return items.map(item => ({ json: item }));
  } catch (error) {
    console.error(`[RSSFeedRead] Error fetching ${url}:`, error.message);
    throw new Error(`Failed to fetch RSS feed: ${error.message}`);
  }
}

/**
 * Simple RSS/Atom XML parser (no external dependency)
 */
function parseRSSFeed(xml) {
  const items = [];

  // Try RSS 2.0 format first (<item> tags)
  const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = rssItemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title'),
      link: extractTag(itemXml, 'link'),
      description: extractTag(itemXml, 'description'),
      content: extractTag(itemXml, 'content:encoded') || extractTag(itemXml, 'content'),
      contentSnippet: stripHtml(extractTag(itemXml, 'description') || extractTag(itemXml, 'content:encoded') || '').substring(0, 500),
      pubDate: extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date'),
      isoDate: normalizeDate(extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date')),
      author: extractTag(itemXml, 'author') || extractTag(itemXml, 'dc:creator'),
      categories: extractAllTags(itemXml, 'category'),
      guid: extractTag(itemXml, 'guid')
    });
  }

  // If no RSS items found, try Atom format (<entry> tags)
  if (items.length === 0) {
    const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']*)["'][^>]*\/?>/i);
      items.push({
        title: extractTag(entryXml, 'title'),
        link: linkMatch ? linkMatch[1] : extractTag(entryXml, 'link'),
        description: extractTag(entryXml, 'summary'),
        content: extractTag(entryXml, 'content'),
        contentSnippet: stripHtml(extractTag(entryXml, 'summary') || extractTag(entryXml, 'content') || '').substring(0, 500),
        pubDate: extractTag(entryXml, 'published') || extractTag(entryXml, 'updated'),
        isoDate: extractTag(entryXml, 'published') || extractTag(entryXml, 'updated'),
        author: extractTag(entryXml, 'name'),
        categories: extractAllTags(entryXml, 'category'),
        guid: extractTag(entryXml, 'id')
      });
    }
  }

  return items;
}

function extractTag(xml, tagName) {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular content
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractAllTags(xml, tagName) {
  const results = [];
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(decodeHtmlEntities(match[1].trim()));
  }
  return results;
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function normalizeDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString();
  } catch (e) {
    return dateStr;
  }
}

module.exports = {
  execute
};
