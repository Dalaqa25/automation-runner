/**
 * Extract From File Executor
 * Handles PDF text extraction using pdf-parse library
 * 
 * Expects file content in:
 * - item.binary.data (from Google Drive download)
 * - Or item.json.fileData / item.json.data etc. as fallback
 */

const { PDFParse } = require('pdf-parse');

/**
 * Decode base64 string to Buffer
 */
function decodeBase64ToBuffer(value) {
  if (typeof value !== 'string') return null;

  // Strip data URI prefix if present
  const dataUriMatch = value.match(/^data:.*;base64,(.*)$/i);
  const b64 = dataUriMatch ? dataUriMatch[1] : value;

  try {
    return Buffer.from(b64, 'base64');
  } catch (err) {
    return null;
  }
}

async function execute(node, inputData = [], executionContext) {
  const params = node.parameters || {};
  const operation = params.operation || 'pdf';

  console.log(`[ExtractFromFile] Processing ${inputData.length} items, operation: ${operation}`);

  const results = [];

  for (const item of inputData) {
    if (!item) {
      console.log(`[ExtractFromFile] Skipping null item`);
      continue;
    }

    try {
      // Find the file data - check binary property first (from Google Drive download)
      let base64Data = null;
      let mimeType = null;
      let fileName = null;

      // Check binary property (standard location for downloaded files)
      if (item.binary) {
        const binaryKey = Object.keys(item.binary)[0]; // Usually 'data'
        if (binaryKey && item.binary[binaryKey]) {
          base64Data = item.binary[binaryKey].data;
          mimeType = item.binary[binaryKey].mimeType;
          fileName = item.binary[binaryKey].fileName;
          console.log(`[ExtractFromFile] Found binary data in item.binary.${binaryKey}, mimeType: ${mimeType}, fileName: ${fileName}`);
        }
      }

      // Fallback to json properties
      if (!base64Data) {
        base64Data = item.json?.fileData ||
          item.json?.file ||
          item.json?.cvBase64 ||
          item.json?.cv ||
          item.json?.data;

        if (base64Data) {
          console.log(`[ExtractFromFile] Found data in json property`);
        }
      }

      if (!base64Data) {
        console.log(`[ExtractFromFile] No file data found in item`);
        results.push({
          json: {
            ...item.json,
            error: 'No file content found to extract',
            text: ''
          }
        });
        continue;
      }

      // Decode base64 to buffer
      const fileBuffer = decodeBase64ToBuffer(base64Data);

      if (!fileBuffer || fileBuffer.length === 0) {
        console.log(`[ExtractFromFile] Failed to decode base64 data`);
        results.push({
          json: {
            ...item.json,
            error: 'Failed to decode file content',
            text: ''
          }
        });
        continue;
      }

      console.log(`[ExtractFromFile] Decoded ${fileBuffer.length} bytes`);

      // Check if it's a PDF
      const isPdf = mimeType === 'application/pdf' ||
        fileName?.toLowerCase().endsWith('.pdf') ||
        fileBuffer.slice(0, 5).toString() === '%PDF-';

      let extractedText = '';

      if (isPdf) {
        console.log(`[ExtractFromFile] Parsing PDF...`);
        let parser = null;
        try {
          parser = new PDFParse({ data: fileBuffer });
          const pdfData = await parser.getText();
          extractedText = pdfData.text;
          console.log(`[ExtractFromFile] Extracted ${extractedText.length} characters from PDF`);
        } catch (pdfError) {
          console.error(`[ExtractFromFile] PDF parsing failed:`, pdfError.message);
          // Try fallback: decode as UTF-8 text
          extractedText = fileBuffer.toString('utf8');
        } finally {
          // Always destroy parser to free memory
          if (parser) {
            try {
              await parser.destroy();
            } catch (e) {
              // Ignore destroy errors
            }
          }
        }
      } else {
        // For non-PDF files, try to decode as text
        console.log(`[ExtractFromFile] Non-PDF file, decoding as text`);
        extractedText = fileBuffer.toString('utf8');
      }

      if (!extractedText || extractedText.trim().length === 0) {
        console.log(`[ExtractFromFile] No text extracted`);
        results.push({
          json: {
            ...item.json,
            error: 'No text could be extracted from file',
            text: ''
          }
        });
        continue;
      }

      results.push({
        json: {
          ...item.json,
          text: extractedText,
          fileName: fileName,
          mimeType: mimeType
        },
        binary: item.binary // Preserve binary data
      });

    } catch (error) {
      console.error(`[ExtractFromFile] Error processing item:`, error.message);
      results.push({
        json: {
          ...item.json,
          error: `Extraction error: ${error.message}`,
          text: ''
        }
      });
    }
  }

  console.log(`[ExtractFromFile] Processed ${results.length} items`);
  return results;
}

module.exports = { execute };
