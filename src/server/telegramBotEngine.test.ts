import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCallbackActionToOptions } from './telegramBotEngine';

test('mapCallbackActionToOptions maps Telegram inline button callback_data to imposition options', () => {
  const stdCard = mapCallbackActionToOptions('card_486x330');
  assert.equal(stdCard.sheetType, '486x330');
  assert.equal(stdCard.mode, 'cards_5x5');

  const quarterCard = mapCallbackActionToOptions('card_350x500');
  assert.equal(quarterCard.sheetType, '350x500');
  assert.equal(quarterCard.mode, 'cards_5x5');

  const centerSheet = mapCallbackActionToOptions('sheet_center');
  assert.equal(centerSheet.sheetType, '486x330');
  assert.equal(centerSheet.mode, 'center_sheet');
});
