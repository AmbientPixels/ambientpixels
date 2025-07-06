module.exports = async function (context, req, galleryBlob) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgegallery');
    
    try {
        // If galleryBlob is available, return it
        if (galleryBlob) {
            // Parse the JSON if it's a string
            const gallery = typeof galleryBlob === 'string' ? JSON.parse(galleryBlob) : galleryBlob;
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: gallery
            };
        } else {
            // If no gallery data found, return empty array
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: []
            };
        }
    } catch (error) {
        context.log.error('Error in cardforgegallery function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while retrieving gallery data' }
        };
    }
};
