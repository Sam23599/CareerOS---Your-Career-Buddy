import { ApiError } from '../errors.js';

export class AnalysisQueries {
  static id(query: Record<string, unknown>): string | undefined {
    const { analysisId } = query;
    if (Object.keys(query).some(key => key !== 'analysisId') || (analysisId !== undefined
      && (typeof analysisId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(analysisId)))) {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid saved analysis.');
    }
    return analysisId;
  }
  static before(query: Record<string, unknown>): number | undefined {
    const { beforeVersion } = query;
    if (Object.keys(query).some(key => key !== 'beforeVersion') || (beforeVersion !== undefined
      && (typeof beforeVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(beforeVersion) || Number(beforeVersion) > 2147483647))) {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid version history cursor.');
    }
    return beforeVersion === undefined ? undefined : Number(beforeVersion);
  }
}
