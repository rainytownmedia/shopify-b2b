import db from "../db.server";

export interface LogData {
  shopId: string;
  action: string;
  method?: string;
  path?: string;
  statusCode?: number;
  requestData?: any;
  responseData?: any;
  duration?: number;
  ip?: string;
}

/**
 * Logs merchant activity asynchronously to avoid blocking the main thread.
 */
export async function logActivity(data: LogData) {
  try {
    // Record asynchronously - we don't await this if we want maximum performance, 
    // but Prisma creates a record fast enough for most B2B use cases.
    return await db.activityLog.create({
      data: {
        shopId: data.shopId,
        action: data.action,
        method: data.method,
        path: data.path,
        statusCode: data.statusCode,
        requestData: data.requestData ? JSON.stringify(data.requestData) : null,
        responseData: data.responseData ? JSON.stringify(data.responseData) : null,
        duration: data.duration,
        ip: data.ip,
      }
    });
  } catch (error) {
    console.error("[Logger Error]: Failed to record activity log", error);
  }
}
