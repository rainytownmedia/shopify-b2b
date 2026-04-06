import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkLogs() {
    console.log("Checking Activity Logs...");
    const logs = await prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    
    if (logs.length === 0) {
        console.log("No logs found.");
    } else {
        logs.forEach((log) => {
            console.log(`[${log.createdAt.toISOString()}] ${log.action} | Status: ${log.statusCode} | Path: ${log.path}`);
            if (log.action === 'API_PROXY_SUCCESS' || log.action === 'API_PROXY_ERROR') {
                console.log("Request Data:", log.requestData);
                console.log("Response Data:", log.responseData);
            }
            console.log("---");
        });
    }
}

checkLogs()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
