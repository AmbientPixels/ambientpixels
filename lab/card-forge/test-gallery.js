/**
 * Card Forge Gallery Testing Utilities
 * This script helps verify the functionality of the gallery features
 * for both signed-in and signed-out states
 */

(function() {
  'use strict';
  
  const tests = {
    // Test utilities
    simulateSignedIn() {
      console.log('🧪 Simulating signed-in state...');
      document.body.setAttribute('data-auth-state', 'signed-in');
      // Trigger auth change event
      document.dispatchEvent(new CustomEvent('cardforge-auth-changed', {
        detail: { state: 'signed-in' }
      }));
      console.log('✅ Simulated signed-in state');
    },
    
    simulateSignedOut() {
      console.log('🧪 Simulating signed-out state...');
      document.body.setAttribute('data-auth-state', 'signed-out');
      // Trigger auth change event
      document.dispatchEvent(new CustomEvent('cardforge-auth-changed', {
        detail: { state: 'signed-out' }
      }));
      console.log('✅ Simulated signed-out state');
    },
    
    // Gallery tests
    async testLoadGallery() {
      console.log('🧪 Testing gallery card loading...');
      try {
        await window.CardForgeGallery.loadGalleryCards();
        const cardCount = document.querySelectorAll('#gallery-cards .gallery-card').length;
        console.log(`✅ Gallery loaded ${cardCount} cards`);
      } catch (error) {
        console.error('❌ Gallery card loading failed:', error);
      }
    },
    
    async testLoadPersonalLibrary() {
      console.log('🧪 Testing personal library loading...');
      try {
        await window.CardForgeGallery.loadPersonalCards();
        const cardCount = document.querySelectorAll('#personal-cards .gallery-card').length;
        console.log(`✅ Personal library loaded ${cardCount} cards`);
      } catch (error) {
        console.error('❌ Personal library loading failed:', error);
      }
    },
    
    // Publishing test
    async testPublishCard() {
      console.log('🧪 Testing card publishing...');
      try {
        const cardId = prompt('Enter a card ID to test publishing:', 'test-card-123');
        if (!cardId) return;
        
        const result = await window.CardForgeGallery.publishCard(cardId);
        console.log('✅ Card published:', result);
      } catch (error) {
        console.error('❌ Card publishing failed:', error);
      }
    },
    
    // Authentication visibility test
    testAuthVisibility() {
      console.log('🧪 Testing authentication-dependent visibility...');
      
      // Test signed-out state
      this.simulateSignedOut();
      const signedOutVisible = document.querySelector('.signed-out-content').offsetParent !== null;
      const signedInHidden = document.querySelector('.signed-in-content').offsetParent === null;
      
      console.log(`Signed-out content visible: ${signedOutVisible}`);
      console.log(`Signed-in content hidden: ${signedInHidden}`);
      
      // Test signed-in state
      this.simulateSignedIn();
      const signedInVisible = document.querySelector('.signed-in-content').offsetParent !== null;
      const signedOutHidden = document.querySelector('.signed-out-content').offsetParent === null;
      
      console.log(`Signed-in content visible: ${signedInVisible}`);
      console.log(`Signed-out content hidden: ${signedOutHidden}`);
      
      if (signedOutVisible && signedInHidden && signedInVisible && signedOutHidden) {
        console.log('✅ Authentication visibility test passed');
      } else {
        console.error('❌ Authentication visibility test failed');
      }
    },
    
    // Run all tests
    async runAll() {
      console.log('🧪 Running all Card Forge Gallery tests...');
      
      console.log('\n--- Testing signed-out experience ---');
      this.simulateSignedOut();
      await this.testLoadGallery();
      
      console.log('\n--- Testing signed-in experience ---');
      this.simulateSignedIn();
      await this.testLoadPersonalLibrary();
      
      console.log('\n--- Testing authentication visibility ---');
      this.testAuthVisibility();
      
      console.log('\n🏁 All tests completed');
    }
  };
  
  // Expose test utilities to global scope
  window.CardForgeTests = tests;
  
  console.log('🧪 Card Forge Gallery test utilities loaded. Run tests using:\n' +
              'CardForgeTests.runAll() - Run all tests\n' +
              'CardForgeTests.testLoadGallery() - Test gallery loading\n' +
              'CardForgeTests.testLoadPersonalLibrary() - Test personal library\n' +
              'CardForgeTests.testAuthVisibility() - Test auth-based visibility\n' +
              'CardForgeTests.testPublishCard() - Test card publishing');
})();
