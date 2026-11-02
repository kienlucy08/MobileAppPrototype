// Every failure in the app carries a code from this catalog. There is no generic "unknown error":
// the fallback (ERR-GEN-000) still shows the raw detail and offers a log export.

export const ERRORS = {
  'ERR-FIELD-001': { title: 'Required answer missing', cause: 'A required question was left blank.', fix: 'Fill missing field', action: 'goto' },
  'ERR-FIELD-002': { title: 'Answer failed a rule', cause: 'The value breaks a constraint defined in the form.', fix: 'Correct the value', action: 'goto' },
  'ERR-FIELD-003': { title: 'Text too long', cause: 'The value is longer than the field allows (this is what silently breaks Survey123 sends).', fix: 'Shorten the text', action: 'goto' },
  'ERR-FIELD-004': { title: 'Wrong number format', cause: 'A number question contains something that is not a valid number.', fix: 'Correct the value', action: 'goto' },
  'ERR-FIELD-005': { title: 'Invalid choice', cause: 'The stored answer is not one of the choices in this form version.', fix: 'Re-select an answer', action: 'goto' },
  'ERR-IMG-001': { title: 'Photo exceeds server size limit', cause: 'The file is larger than the 30 MB per-photo limit.', fix: 'Compress & resend', action: 'retry' },
  'ERR-IMG-002': { title: 'Photo could not be read', cause: 'The image is corrupt, an unsupported format (e.g. HEIC on this browser), or its local copy is gone.', fix: 'Remove and re-add the photo', action: 'goto' },
  'ERR-IMG-003': { title: 'Photo count out of range', cause: 'The number of photos is below the minimum or above the maximum for this question.', fix: 'Add or remove photos', action: 'goto' },
  'ERR-STO-001': { title: 'Device storage is nearly full', cause: 'There is not enough free space to keep another photo safely.', fix: 'Free space or sync first', action: 'none' },
  'ERR-SYNC-001': { title: 'Form version no longer accepted', cause: 'The form was updated on the server after this record was collected.', fix: 'Export this record, then re-enter on the new form version', action: 'export' },
  'ERR-SYNC-002': { title: 'Server does not know this record', cause: 'The upload handshake was lost (server was reset).', fix: 'Retry submission', action: 'retry' },
  'ERR-SYNC-004': { title: 'Server was missing photos at commit', cause: 'Some photos were not durably stored; they have been re-queued automatically.', fix: 'Nothing — re-uploading', action: 'none' },
  'ERR-NET-001': { title: 'Connection dropped mid-request', cause: 'Weak signal; the request did not complete.', fix: 'Automatic retry with backoff', action: 'none' },
  'ERR-NET-002': { title: 'No service', cause: 'The device has no usable connection.', fix: 'Uploads resume automatically when service returns', action: 'none' },
  'ERR-NET-003': { title: 'Response lost after upload', cause: 'The server received the item but the confirmation never arrived.', fix: 'Retry is safe — the server de-duplicates', action: 'none' },
  'ERR-COLLAB-001': { title: 'Teammates still have photos to upload', cause: 'Photos live on the phone that took them until they reach the server; the record can only be submitted once every photo has arrived.', fix: 'Wait for their uploads (progress shown), then submit', action: 'none' },
  'ERR-COLLAB-003': { title: 'A teammate may have unsent changes', cause: 'Someone on the team is offline or still holding edits on their phone. If you submit now, their latest work is added to the record as soon as their phone reconnects — it is never discarded.', fix: 'Wait for them, or submit anyway', action: 'none' },
  'ERR-AUTH-001': { title: 'Your account is no longer signed in', cause: 'The account was removed from FieldSync (or the session was revoked). Records already sent stay on the server under your name.', fix: 'Export what is on this phone, then sign in with another account', action: 'export' },
  'ERR-AUTH-002': { title: 'Wrong username or password', cause: 'Use the same username and password you use on the FieldSync web app.', fix: 'Try again', action: 'none' },
  'ERR-AUTH-003': { title: 'This Microsoft account has no FieldSync access', cause: 'The account is not set up in FieldSync.', fix: 'Ask your admin to add you', action: 'none' },
  'ERR-AUTH-004': { title: 'Your role cannot do that', cause: 'Crew members add photos and data; the crew lead (or a PM) submits the final record and shares or reassigns it.', fix: 'Ask your crew lead', action: 'none' },
  'ERR-GEN-000': { title: 'Unexpected internal error', cause: 'Something the app did not anticipate. Detail is attached to the log entry.', fix: 'Export log and share with support', action: 'export' },
};

export const describe = (code) =>
  ERRORS[code] || { title: 'Unrecognised error code', cause: 'This code is not in the catalog.', fix: 'Export log', action: 'export' };

export class AppError extends Error {
  constructor(code, detail, data) {
    super(detail || describe(code).title);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** Transient transport failure: always safe to retry. */
export class NetError extends AppError {}
