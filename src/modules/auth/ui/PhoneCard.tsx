import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { limits } from '@config';
import { ApiFieldError, apiErrorText } from '@core/api';
import { startPhoneChange } from '../api/authApi';
import type { UserInfo } from '../api/types';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { PHONE_ANCHOR } from './contactAnchors';
import {
  ContactAction,
  ContactCardShell,
  ContactDone,
  ContactForm,
  ContactValue,
} from './ContactCard';
import { PhoneIcon } from './icons';

/** Поле этой формы: под него садится 400, чей суффикс `code` совпал с именем поля запроса. */
const PHONE_FIELDS: ReadonlySet<string> = new Set(['new_phone']);

/**
 * Один ли это номер. Сравниваем цифры, а не строку: пробелы, скобки и дефисы номер новым не делают.
 */
function samePhone(a: string, b: string): boolean {
  return a.replace(/\D/g, '') === b.replace(/\D/g, '');
}

/**
 * Карточка телефона. Установка и смена — один метод: различаются только подпись действия и то, с
 * чего начинается форма, — установка сразу с поля, смена с текущего номера над ним. Код приходит на
 * емаил, а не на новый номер, — об этом говорит подсказка под полем, иначе человек ждал бы SMS.
 * Удаления номера контракт не знает, поэтому и действия такого нет.
 */
export function PhoneCard({
  user,
  editing,
  onEdit,
  onClose,
  done,
}: {
  user: UserInfo;
  /** Правка открыта. Держит её страница: открытой может быть только одна карточка. */
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Номер только что сохранён на экране подтверждения — сказать об этом здесь. */
  done: boolean;
}) {
  const { t } = useTranslation();
  const p = (key: string) => t(`auth.contacts.phone.${key}`);

  return (
    <ContactCardShell id={PHONE_ANCHOR} icon={<PhoneIcon size={22} />} title={p('title')}>
      {done && !editing && <ContactDone title={p('done')} />}
      {editing ? (
        <PhoneForm user={user} onClose={onClose} />
      ) : (
        <ContactValue
          value={user.phone ?? p('empty')}
          empty={!user.phone}
          sub={p('sub')}
          action={
            <ContactAction
              label={t(user.phone ? 'auth.contacts.change' : 'auth.contacts.add')}
              onClick={onEdit}
            />
          }
        />
      )}
    </ContactCardShell>
  );
}

function PhoneForm({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) =>
    t(`auth.contacts.phone.${key}`, opts ?? {});
  const flow = useStartSecurityFlow();
  const [value, setValue] = useState('');
  const [same, setSame] = useState(false);

  const parts = flow.error instanceof ApiFieldError ? flow.error.split(PHONE_FIELDS, t) : null;
  const fieldError = same ? p('same') : parts?.byField.find((f) => f.name === 'new_phone')?.detail;
  const formError = parts ? parts.global : flow.error ? apiErrorText(flow.error, t) : undefined;

  const change = (next: string) => {
    setValue(next);
    setSame(false);
    flow.reset();
  };

  const submit = () => {
    // Операция на тот же номер была бы пустой — ловим до запроса.
    if (user.phone && samePhone(value, user.phone)) {
      setSame(true);
      return;
    }
    const req = { new_phone: value.trim() };
    flow.mutate({ kind: 'phone', start: () => startPhoneChange(req), value: req.new_phone });
  };

  return (
    <>
      <ContactForm
        name="new_phone"
        label={p(user.phone ? 'new' : 'field')}
        value={value}
        onChange={change}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={p('placeholder')}
        maxLength={limits.newPhone.max}
        hint={p('hint', { email: user.email })}
        fieldError={fieldError}
        formError={formError}
        busy={flow.isPending}
        canSubmit={value.trim().length >= limits.newPhone.min && !fieldError}
        onCancel={onClose}
        onSubmit={submit}
      />
    </>
  );
}
