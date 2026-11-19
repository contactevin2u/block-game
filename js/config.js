/* Game-wide settings. Change GAME_NAME here once you pick a name. */
window.CONFIG = {
  GAME_NAME: 'Blokzu',
  VERSION: '1.0.0',
  SESSION_DAYS: 30,
  AD_SECONDS: 10,
  CURRENCY: 'RM',
  RESET_LINK_MINUTES: 30,
  LCD_UNLOCK_LEVEL: 10,
  DAS_MS: 170,
  ARR_MS: 30,
  PRICES: {
    removeAds: 9.99,
    bundle: 25.99,
    themes: { lcd: 9.99, neon: 12.99, paper: 12.99, glass: 14.99, ember: 17.99 },
    coins: [
      { id: 'coins-s', coins: 1000, price: 9.99, label: 'Small pack' },
      { id: 'coins-m', coins: 1800, price: 15.99, label: 'Medium pack', bonus: '+12%' },
      { id: 'coins-l', coins: 3200, price: 25.99, label: 'Large pack', bonus: '+28%' }
    ]
  },
  EQUIPMENT: [
    { id: 'slow', name: 'Slow Time', desc: 'Gravity halved for 20 seconds.', cost: 150, key: '1' },
    { id: 'bomb', name: 'Line Bomb', desc: 'Clears the bottom 2 rows instantly.', cost: 200, key: '2' },
    { id: 'swap', name: 'Piece Swap', desc: 'Replace the current piece with any of the 7.', cost: 120, key: '3' },
    { id: 'shield', name: 'Shield', desc: 'Survive one top-out. The top half of the board is cleared.', cost: 300, key: '4' },
    { id: 'boost', name: 'Score Boost', desc: '1.5x score for the rest of the run.', cost: 250, key: '5' }
  ],
  COINS_PER_LINE: 1,
  // Background music played during games. Add your own MP3s to the music folder and list them here.
  // These two are by Kevin MacLeod (incompetech.com), Creative Commons Attribution 4.0: the credit in Settings must stay.
  MUSIC: [
    { file: 'music/easy-lemon.mp3', title: 'Easy Lemon', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'incompetech.com' },
    { file: 'music/dreamy-flashback.mp3', title: 'Dreamy Flashback', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'incompetech.com' }
  ],
  PAYMENT_METHODS: [
    { id: 'tng', name: "Touch 'n Go eWallet", how: 'Opens the TNG app to approve', fee: '1 to 1.5%' },
    { id: 'fpx', name: 'Online banking (FPX / DuitNow)', how: 'Redirects to your bank login', fee: 'RM 1 flat' },
    { id: 'card', name: 'Credit or debit card', how: 'Card form, then bank 3-D Secure', fee: '1.8 to 3%' },
    { id: 'applepay', name: 'Apple Pay', how: 'Face ID or Touch ID', fee: 'As card', appleOnly: true }
  ]
};
