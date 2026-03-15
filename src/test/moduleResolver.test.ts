import * as assert from 'assert';
import { matchesVersionConstraints } from '../moduleResolver.js';

suite('moduleResolver', () => {
  suite('matchesVersionConstraints', () => {
    test('returns true when no constraints are specified', () => {
      assert.strictEqual(matchesVersionConstraints('1.0.0', {}), true);
      assert.strictEqual(matchesVersionConstraints('0.0.1', {}), true);
    });

    suite('requiredVersion (exact match)', () => {
      test('matches exact version', () => {
        assert.strictEqual(matchesVersionConstraints('1.2.3', { requiredVersion: '1.2.3' }), true);
      });

      test('rejects lower version', () => {
        assert.strictEqual(matchesVersionConstraints('1.2.2', { requiredVersion: '1.2.3' }), false);
      });

      test('rejects higher version', () => {
        assert.strictEqual(matchesVersionConstraints('1.2.4', { requiredVersion: '1.2.3' }), false);
      });
    });

    suite('minimumVersion (inclusive >=)', () => {
      test('accepts version equal to minimum', () => {
        assert.strictEqual(matchesVersionConstraints('0.6.1', { minimumVersion: '0.6.1' }), true);
      });

      test('accepts version above minimum', () => {
        assert.strictEqual(matchesVersionConstraints('1.0.0', { minimumVersion: '0.6.1' }), true);
      });

      test('rejects version below minimum', () => {
        assert.strictEqual(matchesVersionConstraints('0.5.9', { minimumVersion: '0.6.1' }), false);
      });
    });

    suite('maximumVersion (inclusive <=)', () => {
      test('accepts version equal to maximum', () => {
        assert.strictEqual(matchesVersionConstraints('1.0.0', { maximumVersion: '1.0.0' }), true);
      });

      test('accepts version below maximum', () => {
        assert.strictEqual(matchesVersionConstraints('0.9.9', { maximumVersion: '1.0.0' }), true);
      });

      test('rejects version above maximum', () => {
        assert.strictEqual(matchesVersionConstraints('1.0.1', { maximumVersion: '1.0.0' }), false);
      });
    });

    suite('lessThanVersion (exclusive <)', () => {
      test('accepts version strictly below the limit', () => {
        assert.strictEqual(matchesVersionConstraints('1.9.9', { lessThanVersion: '2.0.0' }), true);
      });

      test('rejects version equal to the limit', () => {
        assert.strictEqual(matchesVersionConstraints('2.0.0', { lessThanVersion: '2.0.0' }), false);
      });

      test('rejects version above the limit', () => {
        assert.strictEqual(matchesVersionConstraints('2.0.1', { lessThanVersion: '2.0.0' }), false);
      });
    });

    suite('combined constraints (range)', () => {
      test('accepts version within min..max range', () => {
        assert.strictEqual(
          matchesVersionConstraints('0.7.0', { minimumVersion: '0.5.0', maximumVersion: '1.0.0' }),
          true
        );
      });

      test('accepts version at lower bound', () => {
        assert.strictEqual(
          matchesVersionConstraints('0.5.0', { minimumVersion: '0.5.0', maximumVersion: '1.0.0' }),
          true
        );
      });

      test('accepts version at upper bound', () => {
        assert.strictEqual(
          matchesVersionConstraints('1.0.0', { minimumVersion: '0.5.0', maximumVersion: '1.0.0' }),
          true
        );
      });

      test('rejects version below lower bound', () => {
        assert.strictEqual(
          matchesVersionConstraints('0.4.9', { minimumVersion: '0.5.0', maximumVersion: '1.0.0' }),
          false
        );
      });

      test('rejects version above upper bound', () => {
        assert.strictEqual(
          matchesVersionConstraints('1.0.1', { minimumVersion: '0.5.0', maximumVersion: '1.0.0' }),
          false
        );
      });

      test('accepts version within minimumVersion + lessThanVersion window', () => {
        assert.strictEqual(
          matchesVersionConstraints('0.2.9', { minimumVersion: '0.2.0', lessThanVersion: '0.3.0' }),
          true
        );
      });

      test('rejects version at the lessThanVersion boundary', () => {
        assert.strictEqual(
          matchesVersionConstraints('0.3.0', { minimumVersion: '0.2.0', lessThanVersion: '0.3.0' }),
          false
        );
      });
    });

    suite('multi-segment version comparisons', () => {
      test('correctly compares versions with differing segment counts', () => {
        assert.strictEqual(matchesVersionConstraints('1.0', { minimumVersion: '1.0.0' }), true);
        assert.strictEqual(matchesVersionConstraints('1.0.0', { minimumVersion: '1.0' }), true);
      });

      test('handles four-part versions', () => {
        assert.strictEqual(
          matchesVersionConstraints('1.0.0.1', { minimumVersion: '1.0.0.0', maximumVersion: '1.0.0.5' }),
          true
        );
        assert.strictEqual(
          matchesVersionConstraints('1.0.0.6', { minimumVersion: '1.0.0.0', maximumVersion: '1.0.0.5' }),
          false
        );
      });
    });

    suite('requiredVersion takes precedence over other constraints', () => {
      test('requiredVersion is checked exclusively, ignoring minimumVersion', () => {
        // requiredVersion match — should return true regardless that minimumVersion is also given
        assert.strictEqual(
          matchesVersionConstraints('1.0.0', { requiredVersion: '1.0.0', minimumVersion: '0.5.0' }),
          true
        );
      });

      test('requiredVersion mismatch returns false even if min/max would accept', () => {
        assert.strictEqual(
          matchesVersionConstraints('1.0.1', { requiredVersion: '1.0.0', minimumVersion: '0.5.0' }),
          false
        );
      });
    });
  });
});
