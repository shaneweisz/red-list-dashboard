import { NextRequest, NextResponse } from "next/server";
import { handleCandidatesRequest } from "../candidates-handler";

export function GET(request: NextRequest): NextResponse {
  return handleCandidatesRequest(request, "assessors");
}
