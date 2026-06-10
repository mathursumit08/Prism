import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { permissions } from "../../auth/accessControl.js";
import {
  createTranscript,
  getTranscriptDetail,
  listAnalysisJobs,
  listAuditLog,
  listTranscripts,
  queueTranscriptAnalysis
} from "../../services/customerServiceTranscriptService.js";

const router = Router();

router.use(authenticate);

router.get("/transcripts", requirePermission(permissions.viewCustomerServiceTranscripts), async (request, response) => {
  await respondWithServiceCall(response, () => listTranscripts(request.query, request.user));
});

router.post("/transcripts", requirePermission(permissions.manageCustomerServiceTranscripts), async (request, response) => {
  await respondWithServiceCall(response, () => createTranscript(request.body, request.user), {}, 202);
});

router.get(
  "/transcripts/:transcriptId",
  requirePermission(permissions.viewCustomerServiceTranscripts),
  async (request, response) => {
    await respondWithServiceCall(response, () => getTranscriptDetail(request.params.transcriptId, request.user));
  }
);

router.post(
  "/transcripts/:transcriptId/analyze",
  requirePermission(permissions.analyzeCustomerServiceTranscripts),
  async (request, response) => {
    await respondWithServiceCall(response, () => queueTranscriptAnalysis(request.params.transcriptId, request.user), {}, 202);
  }
);

router.get(
  "/transcripts/:transcriptId/jobs",
  requirePermission(permissions.viewCustomerServiceTranscripts),
  async (request, response) => {
    await respondWithServiceCall(response, () => listAnalysisJobs(request.params.transcriptId, request.user));
  }
);

router.get(
  "/transcripts/:transcriptId/audit",
  requirePermission(permissions.viewCustomerServiceTranscripts),
  async (request, response) => {
    await respondWithServiceCall(response, () => listAuditLog(request.params.transcriptId, request.user));
  }
);

async function respondWithServiceCall(response, action, codeMap = {}, successStatusCode = 200) {
  try {
    const payload = await action();
    response.status(successStatusCode).json(payload);
  } catch (error) {
    const statusCode = error.statusCode || codeMap[error.code] || 500;
    response.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
}

export default router;
