// CORS support added by Cascade 2025-07-12
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
    return;
  }
  
  // Add CORS headers to all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, api-key',
    'Content-Type': 'application/json'
  };
  
  // Handle GET requests for API status checks without query parameters
  /* updated by Cascade 2025-07-15 */
  if (req.method === 'GET' && !req.query.type) {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: "ok", message: "Get Card Template service is online" }
    };
    return;
  }
  
  context.log('JavaScript HTTP trigger function processed a request for card template.');

  try {
    // Get template type from query parameter (default to "character")
    const templateType = (req.query.type || "character").toLowerCase();
    
    // Define different card templates
    const templates = {
      "character": {
        id: "template-character",
        name: "Character Card",
        fields: {
          name: "",
          title: "",
          description: "",
          attributes: {
            strength: 0,
            intelligence: 0,
            charisma: 0,
            agility: 0
          },
          backstory: "",
          imageUrl: "/images/placeholders/character-default.jpg"
        },
        theme: "nova-crystalline",
        version: "1.0.0"
      },
      "location": {
        id: "template-location",
        name: "Location Card",
        fields: {
          name: "",
          region: "",
          description: "",
          features: [],
          history: "",
          imageUrl: "/images/placeholders/location-default.jpg"
        },
        theme: "nova-ambient",
        version: "1.0.0"
      },
      "item": {
        id: "template-item",
        name: "Item Card",
        fields: {
          name: "",
          type: "",
          description: "",
          properties: {
            rarity: "common",
            value: 0,
            weight: 0
          },
          lore: "",
          imageUrl: "/images/placeholders/item-default.jpg"
        },
        theme: "nova-flux",
        version: "1.0.0"
      }
    };

    // Return the requested template or a 404 if not found
    if (templates[templateType]) {
      context.res = {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        },
        body: templates[templateType]
      };
    } else {
      context.res = {
        status: 404,
        body: { 
          error: "Template not found", 
          availableTemplates: Object.keys(templates)
        }
      };
    }
  } catch (error) {
    context.log.error("Error in getCardTemplate function:", error);
    context.res = {
      status: 500,
      body: { error: "Internal server error: " + error.message }
    };
  }
};
