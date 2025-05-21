const fetch = require('node-fetch');

module.exports = async function (context, req) {
    try {
        // Log incoming request
        context.log.info(`Received request for operation: ${req.params.operation}`);
        
        const { operation } = req.params;
        const { method, headers, body } = req;

        // Map DeviantArt API endpoints
        const deviantArtEndpoints = {
            'token': 'https://www.deviantart.com/oauth2/token',
            'gallery': 'https://www.deviantart.com/api/v1/oauth2/gallery/all'
        };

        if (!operation || !deviantArtEndpoints[operation]) {
            context.log.error(`Invalid operation: ${operation}`);
            context.res = {
                status: 400,
                body: { 
                    error: 'Invalid operation',
                    message: `Operation ${operation} is not supported`
                }
            };
            return;
        }

        // Forward headers and body
        const options = {
            method,
            headers: {
                ...headers,
                'Accept': 'application/json',
                'User-Agent': 'NovaDeviantArtProxy/1.0'
            }
        };

        if (body) {
            options.body = body;
        }

        // Make request to DeviantArt API
        context.log.info(`Forwarding request to DeviantArt API`);
        const response = await fetch(deviantArtEndpoints[operation], options);
        
        // Log response status
        context.log.info(`DeviantArt API response status: ${response.status}`);
        
        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            context.log.error('Failed to parse DeviantArt API response:', parseError);
            throw parseError;
        }

        context.res = {
            status: response.status,
            headers: {
                'Content-Type': 'application/json'
            },
            body: data
        };
    } catch (error) {
        context.log.error('DeviantArt proxy error:', error);
        context.res = {
            status: 500,
            body: { 
                error: 'Proxy error',
                message: error.message,
                details: error.stack
            }
        };
    }
};
