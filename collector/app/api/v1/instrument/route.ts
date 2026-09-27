import { NextResponse } from 'next/server';
import { INSTRUMENT_FIELDS, INSTRUMENT_VERSION, REASON_CODES } from '@lvd/shared';

export function GET() {
  return NextResponse.json({ version: INSTRUMENT_VERSION, reasonCodes: REASON_CODES, fields: INSTRUMENT_FIELDS });
}
