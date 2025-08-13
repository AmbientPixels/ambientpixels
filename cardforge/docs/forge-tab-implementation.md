# CardForge V2 – Forge Tab Technical Implementation

**Version:** 1.0  
**Date:** 2025-08-07  
**Author:** Cascade AI  
**Status:** Planning Phase  

## Overview

The Forge tab is the publishing and collection management interface for CardForge V2. It enables users to save cards to their personal collection, publish cards to the public gallery, and manage their card library through Azure Blob Storage integration.

## Current Infrastructure

### Existing Components
- **Azure Blob Storage Integration**: Configured API endpoints for card operations
- **API Endpoints**: `saveCard`, `loadCards`, `publish`, `template`
- **Authentication**: CSRF protection and anonymous access support
- **Validation**: Form validation utilities and error handling
- **UI Framework**: Existing CardForge theme and component system

### Tested Features
- ✅ Save card functionality with JSON upload to blob storage
- ✅ Gallery add feature via publish endpoint
- ✅ Card validation and confirmation dialogs
- ✅ My Cards Manager with local storage

## Architecture Design

### Component Structure
```
Forge Tab (data-step-section="7")
├── Personal Collection Section
│   ├── Save Current Card Component
│   ├── My Cards Grid Component
│   └── Card Management Actions
├── Publishing Section
│   ├── Publish to Gallery Component
│   ├── Published Cards View
│   └── Gallery Management Tools
└── Import/Export Section
    ├── JSON Export/Import
    ├── Bulk Operations
    └── Card Sharing
```

### Data Flow Architecture
```
User Action → UI Component → Validation → API Call → Blob Storage
                ↓
Local Storage ← Response Handler ← API Response ← Blob Storage
                ↓
UI Update ← State Management ← Local Storage
```

## Technical Specifications

### 1. HTML Structure

```html
<div class="cf-section" data-step-section="7">
  <h3 class="cf-section-title">
    <span class="step-index">7</span> Forge
  </h3>
  
  <!-- Personal Collection -->
  <div class="forge-section personal-collection">
    <h4>Personal Collection</h4>
    <div class="forge-actions">
      <button id="save-current-card" class="forge-btn primary">
        <i class="fas fa-save"></i> Save Current Card
      </button>
    </div>
    <div id="personal-cards-grid" class="cards-grid">
      <!-- Personal cards populated by JS -->
    </div>
  </div>
  
  <!-- Publishing -->
  <div class="forge-section publishing">
    <h4>Publishing</h4>
    <div class="forge-actions">
      <button id="publish-to-gallery" class="forge-btn secondary">
        <i class="fas fa-upload"></i> Publish to Gallery
      </button>
    </div>
    <div id="published-cards-grid" class="cards-grid">
      <!-- Published cards populated by JS -->
    </div>
  </div>
  
  <!-- Import/Export -->
  <div class="forge-section import-export">
    <h4>Import/Export</h4>
    <div class="forge-actions">
      <button id="export-card" class="forge-btn tertiary">
        <i class="fas fa-download"></i> Export JSON
      </button>
      <input type="file" id="import-card" accept=".json" style="display: none;">
      <button id="import-card-btn" class="forge-btn tertiary">
        <i class="fas fa-upload"></i> Import JSON
      </button>
    </div>
  </div>
</div>
```

### 2. CSS Architecture

Following Windsurf Protocol for modular, reusable styles:

```css
/* Forge Tab Base Styles */
.forge-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--card-bg);
  border-radius: var(--border-radius);
  border: 1px solid var(--border-color);
}

.forge-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.forge-btn {
  /* Reuse existing button styles */
  @extend .filter-pill;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  transition: all 0.3s ease;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 1rem;
}

.card-item {
  background: var(--tier-bg);
  border-radius: var(--border-radius);
  padding: 1rem;
  border: 1px solid var(--tier-border);
  transition: all 0.3s ease;
}

.card-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--glow-shadow);
}
```

### 3. JavaScript Architecture

#### Core Classes

```javascript
class ForgeManager {
  constructor() {
    this.personalCards = [];
    this.publishedCards = [];
    this.apiEndpoints = window.CardForgeConfig.apiEndpoints;
  }
  
  // Personal Collection Methods
  async saveCurrentCard() { }
  async loadPersonalCards() { }
  async duplicateCard(cardId) { }
  
  // Publishing Methods
  async publishToGallery(cardId) { }
  async loadPublishedCards() { }
  async unpublishCard(cardId) { }
  
  // Import/Export Methods
  exportCardJSON(cardId) { }
  async importCardJSON(jsonData) { }
}

class CardRenderer {
  static renderPersonalCard(cardData) { }
  static renderPublishedCard(cardData) { }
  static renderCardActions(cardData, type) { }
}
```

#### Integration Points

```javascript
// Global exposure following existing pattern
window.CardForge.ForgeManager = ForgeManager;
window.CardForge.CardRenderer = CardRenderer;

// Event binding in main DOMContentLoaded
function initForgeTab() {
  const forgeManager = new ForgeManager();
  
  // Bind save current card
  document.getElementById('save-current-card')
    .addEventListener('click', () => forgeManager.saveCurrentCard());
    
  // Bind publish to gallery
  document.getElementById('publish-to-gallery')
    .addEventListener('click', () => forgeManager.publishToGallery());
    
  // Initialize grids
  forgeManager.loadPersonalCards();
  forgeManager.loadPublishedCards();
}
```

### 4. API Integration

#### Existing Endpoints
- `POST /api/cardforgesavecards` - Save card to personal collection
- `GET /api/cardforgeloadcards` - Load user's personal cards
- `DELETE /api/cardforgedeletecard` - Delete card from collection
- `POST /api/cardforgepublish` - Publish card to public gallery

#### Data Structures

```javascript
// Personal Card Object
const personalCard = {
  id: 'v2-{timestamp}',
  name: 'Card Name',
  class: 'Card Class',
  quote: 'Card Quote',
  avatar: 'Image URL',
  modularState: {
    palette: 'neon-vibrant',
    imageContainer: 'masked-circle',
    // ... all modular settings
  },
  stats: [...],
  socialLinks: [...],
  badges: [...],
  attributes: [...],
  createdAt: '2025-08-07T22:15:21Z',
  updatedAt: '2025-08-07T22:15:21Z',
  version: '2.0'
};

// Published Card Object (extends personal card)
const publishedCard = {
  ...personalCard,
  publishedAt: '2025-08-07T22:15:21Z',
  isPublic: true,
  approvalStatus: 'approved', // pending, approved, rejected
  views: 0,
  likes: 0
};
```

## Implementation Phases

### Phase 1: Core UI Structure
**Timeline:** 1-2 days  
**Deliverables:**
- Forge tab HTML section
- Basic CSS styling
- Tab navigation integration
- Empty state displays

**Acceptance Criteria:**
- Forge tab accessible via navigation
- Responsive layout on all screen sizes
- Consistent with existing CardForge theme
- Empty states show appropriate messaging

### Phase 2: Personal Collection
**Timeline:** 2-3 days  
**Deliverables:**
- Save current card functionality
- Personal cards grid display
- Card management actions (edit, delete, duplicate)
- Local storage synchronization

**Acceptance Criteria:**
- Save button captures all card data including modular state
- Personal cards display in responsive grid
- Edit action loads card into editor
- Delete action removes from both local and blob storage
- Duplicate creates new card with incremented name

### Phase 3: Publishing System
**Timeline:** 2-3 days  
**Deliverables:**
- Publish to gallery workflow
- Published cards management
- Gallery submission UI
- Public/private visibility controls

**Acceptance Criteria:**
- Publish button uploads card to public gallery
- Published cards show different status indicators
- Users can unpublish their cards
- Gallery submissions include metadata

### Phase 4: Import/Export & Polish
**Timeline:** 1-2 days  
**Deliverables:**
- JSON export/import functionality
- Bulk operations
- Error handling improvements
- Performance optimizations

**Acceptance Criteria:**
- Export generates valid JSON with all card data
- Import validates and loads card data correctly
- Bulk operations work with multiple selections
- All error states handled gracefully

## Security Considerations

### Data Validation
- Client-side validation for all form inputs
- Server-side validation on all API endpoints
- Sanitization of user-generated content
- File type validation for imports

### Access Control
- CSRF token validation on all state-changing operations
- Rate limiting on API endpoints
- User session validation
- Blob storage access controls

### Privacy
- Personal cards remain private by default
- Published cards require explicit user consent
- No sensitive data in client-side logs
- Secure handling of user-generated content

## Performance Considerations

### Optimization Strategies
- Lazy loading of card grids
- Image optimization and caching
- Debounced search and filtering
- Pagination for large collections

### Caching Strategy
- Local storage for frequently accessed cards
- Browser cache for static assets
- CDN for published card images
- API response caching where appropriate

## Testing Strategy

### Unit Tests
- ForgeManager class methods
- CardRenderer utility functions
- Data validation functions
- API integration points

### Integration Tests
- Save/load workflow end-to-end
- Publish/unpublish workflow
- Import/export functionality
- Cross-browser compatibility

### User Acceptance Tests
- Complete card creation and save workflow
- Gallery publishing and management
- Import/export of card collections
- Error handling and recovery

## Monitoring & Analytics

### Key Metrics
- Card save success rate
- Gallery publish conversion rate
- Import/export usage
- Error rates by operation type

### Logging Strategy
- Client-side error logging
- API endpoint performance monitoring
- User action tracking (privacy-compliant)
- Blob storage operation metrics

## Future Enhancements

### Planned Features
- Card templates and themes
- Collaborative editing
- Card collections and decks
- Advanced search and filtering
- Social features (likes, comments)

### Technical Debt
- Migrate from local storage to IndexedDB for large collections
- Implement offline-first architecture
- Add real-time collaboration features
- Optimize bundle size and loading performance

## Dependencies

### External Libraries
- Existing CardForge UI framework
- Font Awesome icons
- Azure Blob Storage SDK (via API)
- CSRF protection utilities

### Internal Dependencies
- CardForge modular system
- Existing validation utilities
- Theme and styling system
- API configuration and helpers

## Deployment Checklist

### Pre-deployment
- [ ] All unit tests passing
- [ ] Integration tests completed
- [ ] Cross-browser testing done
- [ ] Performance benchmarks met
- [ ] Security review completed

### Deployment
- [ ] Feature flags configured
- [ ] Monitoring dashboards updated
- [ ] Documentation updated
- [ ] User guides created
- [ ] Rollback plan prepared

### Post-deployment
- [ ] Monitor error rates
- [ ] Validate key user workflows
- [ ] Collect user feedback
- [ ] Performance monitoring active
- [ ] Analytics tracking confirmed

---

**Document Status:** Draft  
**Next Review:** After Phase 1 completion  
**Stakeholders:** Development Team, Product Owner, QA Team
