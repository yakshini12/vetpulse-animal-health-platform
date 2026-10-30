import '@testing-library/jest-dom/vitest';

// jsdom has no scrollIntoView; silence unrelated React act() noise is not needed
// with these small unit tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
