/* updated by Cascade 2025-07-15 */

/**
 * CardForge Template API
 * Returns card templates based on requested type
 */
module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgetemplate');
  // Debug: log incoming request details
  context.log(`[DEBUG] method=${req.method} query=${JSON.stringify(req.query)} headers=${JSON.stringify(req.headers)}`);
  
  // Add CORS headers to all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token, x-functions-key",
    "Content-Type": "application/json"
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }
  
  // Handle GET requests for API status checks without query parameters
  /* updated by Cascade 2025-07-15 */
  if (req.method === "GET" && !req.query.type) {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: "ok", message: "CardForge Template service is online" }
    };
    return;
  }

  try {
    // Get the template type from query parameters
    const type = req.query.type || 'character';
    
    // Validate template type
    if (!['character', 'location', 'item'].includes(type)) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: { error: `Invalid template type: ${type}. Valid types are: character, location, item` }
      };
      return;
    }
    
    // Get the appropriate template
    const template = getTemplateByType(type);
    
    // Return the template
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=3600' // Cache for 1 hour
      },
      body: template
    };
  } catch (error) {
    context.log.error(`Error in cardforgetemplate: ${error.message}`);
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: { error: error.message }
    };
  }
};

/**
 * Get a template by type
 * @param {string} type - The template type (character, location, item)
 * @returns {object} The template object
 */
function getTemplateByType(type) {
  switch (type) {
    case 'character':
      return {
        type: 'character',
        name: 'Character Card',
        description: 'Template for creating character cards',
        theme: 'nova-crystalline',
        fields: {
          name: {
            type: 'text',
            label: 'Character Name',
            placeholder: 'Enter character name',
            description: 'The name of your character',
            required: true,
            maxLength: 30
          },
          class: {
            type: 'text',
            label: 'Class',
            placeholder: 'e.g. Ranger, Wizard, Rogue',
            description: 'Character class or profession',
            required: true,
            maxLength: 20
          },
          quote: {
            type: 'textarea',
            label: 'Quote',
            placeholder: 'A memorable quote or saying',
            description: 'A quote that captures your character\'s personality',
            required: false,
            maxLength: 100
          },
          avatar: {
            type: 'url',
            label: 'Avatar URL',
            placeholder: 'https://...',
            description: 'URL to an image of your character',
            required: true
          },
          achievement: {
            type: 'text',
            label: 'Achievement',
            placeholder: 'e.g. Slayer of Dragons',
            description: 'A notable achievement or title',
            required: false,
            maxLength: 50
          }
        }
      };
      
    case 'location':
      return {
        type: 'location',
        name: 'Location Card',
        description: 'Template for creating location cards',
        theme: 'nova-crystalline',
        fields: {
          name: {
            type: 'text',
            label: 'Location Name',
            placeholder: 'Enter location name',
            description: 'The name of your location',
            required: true,
            maxLength: 30
          },
          class: {
            type: 'text',
            label: 'Type',
            placeholder: 'e.g. Castle, Forest, City',
            description: 'The type of location',
            required: true,
            maxLength: 20
          },
          quote: {
            type: 'textarea',
            label: 'Description',
            placeholder: 'A brief description of this place',
            description: 'A short description that captures the essence of this location',
            required: false,
            maxLength: 100
          },
          avatar: {
            type: 'url',
            label: 'Image URL',
            placeholder: 'https://...',
            description: 'URL to an image of your location',
            required: true
          },
          achievement: {
            type: 'text',
            label: 'Notable Feature',
            placeholder: 'e.g. Home of the Ancient Dragon',
            description: 'A notable feature or historical significance',
            required: false,
            maxLength: 50
          }
        }
      };
      
    case 'item':
      return {
        type: 'item',
        name: 'Item Card',
        description: 'Template for creating item cards',
        theme: 'nova-crystalline',
        fields: {
          name: {
            type: 'text',
            label: 'Item Name',
            placeholder: 'Enter item name',
            description: 'The name of your item',
            required: true,
            maxLength: 30
          },
          class: {
            type: 'text',
            label: 'Category',
            placeholder: 'e.g. Weapon, Artifact, Tool',
            description: 'The category of item',
            required: true,
            maxLength: 20
          },
          quote: {
            type: 'textarea',
            label: 'Description',
            placeholder: 'A brief description of this item',
            description: 'A short description of the item\'s appearance or properties',
            required: false,
            maxLength: 100
          },
          avatar: {
            type: 'url',
            label: 'Image URL',
            placeholder: 'https://...',
            description: 'URL to an image of your item',
            required: true
          },
          achievement: {
            type: 'text',
            label: 'Special Property',
            placeholder: 'e.g. Glows in the dark',
            description: 'A special property or power of this item',
            required: false,
            maxLength: 50
          }
        }
      };
      
    default:
      throw new Error(`Unknown template type: ${type}`);
  }
}
