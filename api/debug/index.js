// CardForge API Debug Function
// Following Windsurf Dev Protocol - Check Before You Code

module.exports = async function (context, req) {
    context.log('CardForge Debug API invoked');
    
    try {
        // Check for basic environment
        const environment = {
            nodeVersion: process.version,
            nodeEnv: process.env.NODE_ENV,
            hasStorageConnection: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
            connectionStringStart: process.env.AZURE_STORAGE_CONNECTION_STRING 
                ? process.env.AZURE_STORAGE_CONNECTION_STRING.substring(0, 10) + '...' 
                : 'Not set',
            apiRoute: req.originalUrl || req.url || 'Unknown',
            headers: req.headers,
            functionDirectory: __dirname,
            functionName: context.executionContext?.functionName || 'Unknown'
        };
        
        context.res = {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-ID, Authorization'
            },
            body: {
                message: 'CardForge API Debug Info',
                timestamp: new Date().toISOString(),
                environment: environment
            }
        };
    } catch (error) {
        context.res = {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { 
                message: 'Debug API Error',
                error: error.message,
                stack: error.stack
            }
        };
    }
};
