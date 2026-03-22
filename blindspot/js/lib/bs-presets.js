/**
 * CardForge Preset Configurations
 * Extracted from card-forge-editor.js for maintainability.
 * Each preset defines front-of-card styling + sample character data.
 * Loaded before card-forge-editor.js — consumed via window.PresetConfigurations.
 */
window.PresetConfigurations = {
  'hero-classic': {
    // Front-of-card styling
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    palette: 'earth',
    paletteVariant: 'light',
    imageContainer: 'framed',
    imageContainerVariant: 'ornate',
    imageEffect: 'borders',
    imageEffectVariant: 'glow',
    // Class and Rarity Styling
    classStyle: 'badge',
    classIcon: 'khanda',
    rarityStyle: 'glow',
    rarityIcon: 'gem',
    // Back-of-card sample data
    sampleData: {
      name: 'Fantasy Ranger',
      characterClass: 'Scout',
      characterSubclass: 'Elven Archer',
      avatar: '/images/image-packs/characters/whispers-of-the-sylvan-queen.jpg',
      biography: 'A skilled archer from the Whispering Woods, protector of ancient secrets and guardian of the realm.',
      badges: [
        { category: 'Marksman', icon: 'target', quantity: 3, description: 'Expert archer with unmatched precision' },
        { category: 'Explorer', icon: 'star', quantity: 2, description: 'Discovered hidden paths and ancient ruins' },
        { category: 'Beast Friend', icon: 'heart', quantity: 1, description: 'Trusted companion of forest creatures' }
      ],
      attributes: [
        { name: 'Agility', value: '18' },
        { name: 'Wisdom', value: '16' },
        { name: 'Stealth', value: '14' },
        { name: 'Nature Lore', value: 'Expert' }
      ],
      stats: [
        { name: 'Health', value: 78 },
        { name: 'Mana', value: 64 },
        { name: 'Stamina', value: 82 },
        { name: 'Archery', value: 91 },
        { name: 'Survival', value: 73 }
      ]
    }
  },
  'split-modern': {
    horizontalAlignment: 'left',
    verticalAlignment: 'middle',
    alignmentWeight: 'top-heavy',
    alignmentStyle: 'compact',
    palette: 'ocean',
    paletteVariant: 'dark',
    imageContainer: 'framed',
    imageContainerVariant: 'modern',
    imageEffect: 'borders',
    imageEffectVariant: 'solid',
    classStyle: 'glow',
    classIcon: 'cog',
    rarityStyle: 'foil',
    rarityIcon: 'bolt',
    sampleData: {
      name: 'Cyberpunk Runner',
      characterClass: 'Hacker',
      characterSubclass: 'Data Netrunner',
      avatar: '/images/image-packs/characters/cyber-erenity.jpg',
      biography: 'Elite netrunner specializing in corporate infiltration and data extraction from high-security systems.',
      badges: [
        { category: 'Hacker', icon: 'bolt', quantity: 4, description: 'Master of digital infiltration' },
        { category: 'Ghost Protocol', icon: 'shield', quantity: 2, description: 'Invisible in the net' },
        { category: 'System Breaker', icon: 'fire', quantity: 1, description: 'Can crack any firewall' }
      ],
      attributes: [
        { name: 'Tech', value: '20' },
        { name: 'Stealth', value: '17' },
        { name: 'Logic', value: '15' },
        { name: 'Reputation', value: 'Legendary' }
      ],
      stats: [
        { name: 'Processing', value: 87 },
        { name: 'Security', value: 72 },
        { name: 'Speed', value: 91 },
        { name: 'Hacking', value: 84 },
        { name: 'Stealth', value: 69 }
      ]
    }
  },
  'minimal-glow': {
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'compact',
    palette: 'monochrome',
    paletteVariant: 'light',
    imageContainer: 'raw',
    imageContainerVariant: 'rounded',
    imageEffect: 'borders',
    imageEffectVariant: 'glow',
    classStyle: 'outlined',
    classIcon: 'book',
    rarityStyle: 'border',
    rarityIcon: 'scroll',
    sampleData: {
      name: 'Arcane Scholar',
      characterClass: 'Scholar',
      characterSubclass: 'Mystic Researcher',
      avatar: '/images/image-packs/characters/ethereal-enigma.jpg',
      biography: 'Renowned scholar of ancient magics and forbidden knowledge, keeper of the Great Library.',
      badges: [
        { category: 'Scholar', icon: 'star', quantity: 4, description: 'Master of ancient texts' },
        { category: 'Spell Weaver', icon: 'gem', quantity: 3, description: 'Creator of new magical formulas' },
        { category: 'Ancient Lore', icon: 'crown', quantity: 2, description: 'Keeper of forgotten secrets' }
      ],
      attributes: [
        { name: 'Intelligence', value: '20' },
        { name: 'Wisdom', value: '17' },
        { name: 'Focus', value: '15' },
        { name: 'Research', value: 'Masterful' }
      ],
      stats: [
        { name: 'Knowledge', value: 93 },
        { name: 'Concentration', value: 68 },
        { name: 'Memory', value: 85 },
        { name: 'Research', value: 79 },
        { name: 'Wisdom', value: 88 }
      ]
    }
  },
  'fullbleed-cinematic': {
    horizontalAlignment: 'center',
    verticalAlignment: 'bottom',
    alignmentWeight: 'bottom-heavy',
    alignmentStyle: 'padded',
    palette: 'sunset',
    paletteVariant: 'dark',
    imageContainer: 'fullbleed',
    imageContainerVariant: 'none',
    imageEffect: 'filters',
    imageEffectVariant: 'sepia',
    classStyle: 'banner',
    classIcon: 'shield',
    rarityStyle: 'frame',
    rarityIcon: 'star',
    sampleData: {
      name: 'Space Marine',
      characterClass: 'Fighter',
      characterSubclass: 'Galactic Warrior',
      avatar: '/images/image-packs/characters/guardian-of-the-gilded-halls.jpg',
      biography: 'Veteran space marine with decades of combat experience across multiple star systems. Leader of the Phoenix Squadron and defender of the galaxy.',
      badges: [
        { category: 'Combat Veteran', icon: 'medal', quantity: 5, description: 'Survived countless battles' },
        { category: 'Leadership', icon: 'crown', quantity: 3, description: 'Inspires troops to victory' },
        { category: 'Pilot', icon: 'star', quantity: 2, description: 'Ace starfighter pilot' }
      ],
      attributes: [
        { name: 'Strength', value: '19' },
        { name: 'Leadership', value: '18' },
        { name: 'Tactics', value: '16' },
        { name: 'Honor', value: 'Unbreakable' }
      ],
      stats: [
        { name: 'Combat', value: 89 },
        { name: 'Command', value: 76 },
        { name: 'Morale', value: 83 },
        { name: 'Tactics', value: 92 },
        { name: 'Armor', value: 85 }
      ]
    }
  },
  'framed-ornate': {
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    palette: 'neon',
    paletteVariant: 'dark',
    imageContainer: 'framed',
    imageContainerVariant: 'ornate',
    imageEffect: 'borders',
    imageEffectVariant: 'neon',
    classStyle: 'badge',
    classIcon: 'cut',
    rarityStyle: 'glow',
    rarityIcon: 'trophy',
    sampleData: {
      name: 'Corporate Ronin',
      characterClass: 'Rogue',
      characterSubclass: 'Blade for Hire',
      avatar: '/images/image-packs/characters/the-enigmatic-neuromancer.jpg',
      biography: 'Former corporate security turned freelance blade for hire, walking the path of honor in a corrupt world.',
      badges: [
        { category: 'Blade Master', icon: 'trophy', quantity: 4, description: 'Unmatched sword technique' },
        { category: 'Honor Code', icon: 'shield', quantity: 2, description: 'Lives by ancient principles' },
        { category: 'Street Smart', icon: 'target', quantity: 3, description: 'Knows the urban jungle' }
      ],
      attributes: [
        { name: 'Reflexes', value: '19' },
        { name: 'Honor', value: '16' },
        { name: 'Combat', value: '18' },
        { name: 'Reputation', value: 'Respected' }
      ],
      stats: [
        { name: 'Speed', value: 94 },
        { name: 'Precision', value: 81 },
        { name: 'Focus', value: 77 },
        { name: 'Honor', value: 86 },
        { name: 'Blade Mastery', value: 90 }
      ]
    }
  },
  'hero-fullbleed': {
    horizontalAlignment: 'center',
    verticalAlignment: 'bottom',
    alignmentWeight: 'balanced',
    alignmentStyle: 'compact',
    palette: 'fire',
    paletteVariant: 'dark',
    imageContainer: 'fullbleed',
    imageContainerVariant: 'standard',
    imageEffect: 'overlay',
    imageEffectVariant: 'gradient',
    classStyle: 'banner',
    classIcon: 'crown',
    rarityStyle: 'foil',
    rarityIcon: 'sun',
    sampleData: {
      name: 'Legendary Hero',
      characterClass: 'Guardian',
      characterSubclass: 'Champion of Justice',
      avatar: '/images/image-packs/characters-03-super-heroes/nova-rivera.png',
      biography: 'Champion of justice and defender of the innocent. Wielder of ancient powers and leader of the legendary Phoenix Guard.',
      badges: [
        { category: 'Hero', icon: 'crown', quantity: 5, description: 'Legendary status among all heroes' },
        { category: 'Leader', icon: 'star', quantity: 4, description: 'Commands respect and loyalty' },
        { category: 'Champion', icon: 'trophy', quantity: 3, description: 'Victor in countless battles' }
      ],
      attributes: [
        { name: 'Strength', value: '20' },
        { name: 'Courage', value: '19' },
        { name: 'Leadership', value: '18' },
        { name: 'Honor', value: 'Legendary' }
      ],
      stats: [
        { name: 'Health', value: 88 },
        { name: 'Energy', value: 92 },
        { name: 'Spirit', value: 95 },
        { name: 'Strength', value: 87 },
        { name: 'Leadership', value: 93 }
      ]
    }
  },
  'hero-large': {
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    palette: 'sunset',
    paletteVariant: 'light',
    imageContainer: 'hero',
    imageContainerVariant: 'large',
    imageEffect: 'shadow',
    imageEffectVariant: 'soft',
    classStyle: 'glow',
    classIcon: 'hammer',
    rarityStyle: 'frame',
    rarityIcon: 'diamond',
    sampleData: {
      name: 'Titan Guardian',
      characterClass: 'Guardian',
      characterSubclass: 'Divine Protector',
      avatar: '/images/image-packs/characters/twilight-titan.jpg',
      biography: 'A towering guardian blessed by the gods, standing watch over sacred temples and protecting the faithful from darkness.',
      badges: [
        { category: 'Divine', icon: 'crown', quantity: 4, description: 'Blessed with divine power and authority' },
        { category: 'Guardian', icon: 'shield', quantity: 5, description: 'Eternal protector of the sacred realm' },
        { category: 'Strength', icon: 'trophy', quantity: 3, description: 'Possesses incredible physical might' }
      ],
      attributes: [
        { name: 'Strength', value: '20' },
        { name: 'Constitution', value: '19' },
        { name: 'Wisdom', value: '17' },
        { name: 'Divine Favor', value: 'Blessed' }
      ],
      stats: [
        { name: 'Health', value: 97 },
        { name: 'Divine Power', value: 83 },
        { name: 'Endurance', value: 90 },
        { name: 'Strength', value: 94 },
        { name: 'Protection', value: 89 }
      ]
    }
  },
  'raw-rounded': {
    horizontalAlignment: 'left',
    verticalAlignment: 'middle',
    alignmentWeight: 'top-heavy',
    alignmentStyle: 'compact',
    palette: 'monochrome',
    paletteVariant: 'dark',
    imageContainer: 'raw',
    imageContainerVariant: 'rounded',
    imageEffect: 'none',
    imageEffectVariant: 'none',
    classStyle: 'outlined',
    classIcon: 'eye',
    rarityStyle: 'border',
    rarityIcon: 'moon',
    sampleData: {
      name: 'Shadow Operative',
      characterClass: 'Rogue',
      characterSubclass: 'Stealth Specialist',
      avatar: '/images/image-packs/characters/navigator-kairo.jpg',
      biography: 'A master of stealth and infiltration, operating in the shadows to gather intelligence and eliminate threats with surgical precision.',
      badges: [
        { category: 'Stealth', icon: 'target', quantity: 5, description: 'Undetectable in shadows and silence' },
        { category: 'Precision', icon: 'star', quantity: 4, description: 'Every move calculated and exact' },
        { category: 'Intel', icon: 'trophy', quantity: 2, description: 'Master of information gathering' }
      ],
      attributes: [
        { name: 'Stealth', value: '20' },
        { name: 'Dexterity', value: '18' },
        { name: 'Intelligence', value: '16' },
        { name: 'Infiltration', value: 'Expert' }
      ],
      stats: [
        { name: 'Stealth', value: 96 },
        { name: 'Agility', value: 85 },
        { name: 'Focus', value: 71 },
        { name: 'Intelligence', value: 82 },
        { name: 'Infiltration', value: 88 }
      ]
    }
  },
  'celestial-warden': {
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    palette: 'ocean',
    paletteVariant: 'light',
    imageContainer: 'framed',
    imageContainerVariant: 'ornate',
    imageEffect: 'borders',
    imageEffectVariant: 'glow',
    classStyle: 'badge',
    classIcon: 'crown',
    rarityStyle: 'glow',
    rarityIcon: 'star',
    sampleData: {
      name: 'Celestial Warden',
      characterClass: 'Guardian',
      characterSubclass: 'Divine Sentinel',
      avatar: '/images/image-packs/characters/seraphina.jpg',
      biography: 'A radiant guardian chosen by the stars, sworn to protect the boundary between mortal and celestial realms.',
      badges: [
        { category: 'Divine Light', icon: 'star', quantity: 4, description: 'Channel of celestial radiance' },
        { category: 'Warden', icon: 'shield', quantity: 3, description: 'Eternal guardian of the veil' },
        { category: 'Prophecy', icon: 'gem', quantity: 2, description: 'Sees threads of fate' }
      ],
      attributes: [
        { name: 'Wisdom', value: '20' },
        { name: 'Spirit', value: '18' },
        { name: 'Radiance', value: '17' },
        { name: 'Devotion', value: 'Absolute' }
      ],
      stats: [
        { name: 'Holy Power', value: 92 },
        { name: 'Protection', value: 88 },
        { name: 'Insight', value: 79 },
        { name: 'Resilience', value: 85 },
        { name: 'Grace', value: 94 }
      ]
    }
  },
  'flame-oracle': {
    horizontalAlignment: 'center',
    verticalAlignment: 'bottom',
    alignmentWeight: 'bottom-heavy',
    alignmentStyle: 'padded',
    palette: 'fire',
    paletteVariant: 'dark',
    imageContainer: 'fullbleed',
    imageContainerVariant: 'none',
    imageEffect: 'overlay',
    imageEffectVariant: 'gradient',
    classStyle: 'banner',
    classIcon: 'dragon',
    rarityStyle: 'foil',
    rarityIcon: 'fire',
    sampleData: {
      name: 'Flame Oracle',
      characterClass: 'Caster',
      characterSubclass: 'Pyromantic Seer',
      avatar: '/images/image-packs/characters/ember-gaze.jpg',
      biography: 'A seer who reads the future in dancing flames, wielding fire as both weapon and window to destiny.',
      badges: [
        { category: 'Pyromancy', icon: 'fire', quantity: 5, description: 'Master of sacred flames' },
        { category: 'Oracle', icon: 'gem', quantity: 3, description: 'Visions forged in fire' },
        { category: 'Destroyer', icon: 'bolt', quantity: 2, description: 'Unleashes devastating infernos' }
      ],
      attributes: [
        { name: 'Intelligence', value: '19' },
        { name: 'Willpower', value: '18' },
        { name: 'Fire Mastery', value: '20' },
        { name: 'Foresight', value: 'Prophetic' }
      ],
      stats: [
        { name: 'Fire Power', value: 95 },
        { name: 'Vision', value: 82 },
        { name: 'Intensity', value: 88 },
        { name: 'Control', value: 74 },
        { name: 'Divination', value: 91 }
      ]
    }
  }
};
