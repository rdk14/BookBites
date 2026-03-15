/**
 * BookBites – Google Apps Script Web App
 *
 * Deploy this script as a Web App inside a Google Sheet:
 *   1. Open or create a Google Sheet.
 *   2. Go to Extensions → Apps Script.
 *   3. Paste this file (replace any existing code).
 *   4. Click Deploy → New deployment → Web App.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the deployment URL and set it as REACT_APP_SHEETS_URL
 *      in your Vercel / .env environment variables.
 *
 * Sheet structure (created automatically if missing):
 *   Column A: bookTitle    – filename without .pdf extension
 *   Column B: pdfFilename  – original filename  (e.g. "My Book.PDF")
 *   Column C: cards        – JSON-serialised card array
 *   Column D: savedAt      – ISO-8601 timestamp
 */

const SHEET_NAME = "BookBites";

/** Returns (and creates if needed) the BookBites sheet. */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["bookTitle", "pdfFilename", "cards", "savedAt"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * GET handler – looks up cached cards by bookTitle OR pdfFilename.
 *
 * Query params:
 *   bookTitle   – book title string (filename without extension)
 *   pdfFilename – original PDF filename
 *
 * Returns: { cards: Card[] }  (empty array when no match found)
 */
function doGet(e) {
  const bookTitle   = (e.parameter.bookTitle   || "").trim();
  const pdfFilename = (e.parameter.pdfFilename || "").trim();

  if (!bookTitle && !pdfFilename) {
    return jsonResponse({ cards: [] });
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  const titleLower    = bookTitle.toLowerCase();
  const filenameLower = pdfFilename.toLowerCase();

  // Row 0 is the header; iterate from row 1 onward.
  for (let i = 1; i < data.length; i++) {
    const rowTitle    = (data[i][0] || "").toString().trim().toLowerCase();
    const rowFilename = (data[i][1] || "").toString().trim().toLowerCase();

    const titleMatch    = titleLower    && rowTitle    === titleLower;
    const filenameMatch = filenameLower && rowFilename === filenameLower;

    if (titleMatch || filenameMatch) {
      try {
        const cards = JSON.parse(data[i][2]);
        return jsonResponse({ cards: cards });
      } catch (parseErr) {
        // Row has corrupted JSON – skip it and keep looking.
      }
    }
  }

  return jsonResponse({ cards: [] });
}

/**
 * POST handler – saves (or updates) cards for a book.
 *
 * Request body (JSON):
 *   { bookTitle: string, pdfFilename: string, cards: Card[] }
 *
 * Returns: { success: boolean, updated: boolean }
 */
function doPost(e) {
  try {
    const payload     = JSON.parse(e.postData.contents);
    const bookTitle   = (payload.bookTitle   || "").trim();
    const pdfFilename = (payload.pdfFilename || "").trim();
    const cards       = payload.cards;

    if (!bookTitle || !Array.isArray(cards) || !cards.length) {
      return jsonResponse({ success: false, error: "Missing bookTitle or cards" });
    }

    const sheet     = getSheet();
    const data      = sheet.getDataRange().getValues();
    const cardsJson = JSON.stringify(cards);
    const now       = new Date().toISOString();

    const titleLower    = bookTitle.toLowerCase();
    const filenameLower = pdfFilename.toLowerCase();

    // Update the existing row if a match is found.
    for (let i = 1; i < data.length; i++) {
      const rowTitle    = (data[i][0] || "").toString().trim().toLowerCase();
      const rowFilename = (data[i][1] || "").toString().trim().toLowerCase();

      const titleMatch    = titleLower    && rowTitle    === titleLower;
      const filenameMatch = filenameLower && rowFilename === filenameLower;

      if (titleMatch || filenameMatch) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([[bookTitle, pdfFilename, cardsJson, now]]);
        return jsonResponse({ success: true, updated: true });
      }
    }

    // No existing row – append a new one.
    sheet.appendRow([bookTitle, pdfFilename, cardsJson, now]);
    return jsonResponse({ success: true, updated: false });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/** Helper: wraps an object as a JSON ContentService response. */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
