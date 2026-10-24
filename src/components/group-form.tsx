import { SortableParticipant } from '@/app/groups/[groupId]/edit/sortable-participants'
import { PaymentMethodsEditor } from '@/components/payment-methods-editor'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Locale } from '@/i18n/request'
import { defaultCurrencyList, getCurrency } from '@/lib/currency'
import type { Group } from '@/lib/kv/types'
import {
  GROUP_INFORMATION_MAX,
  GroupFormValues,
  groupFormSchema,
} from '@/lib/schemas'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { CurrencySelector } from './currency-selector'
import { Textarea } from './ui/textarea'

/** Stored as `${groupId}-activeUser` when nobody is the active user. */
const NO_ACTIVE_USER = 'None'
/** Select value prefix for a participant that is not saved yet (no id). */
const NEW_PARTICIPANT_PREFIX = 'new:'

export type Props = {
  group?: Group
  onSubmit: (
    groupFormValues: GroupFormValues,
    participantId?: string,
  ) => Promise<void>
  onDelete?: () => Promise<void> | void
  protectedParticipantIds?: string[]
}

export function GroupForm({
  group,
  onSubmit,
  onDelete,
  protectedParticipantIds = [],
}: Props) {
  const locale = useLocale()
  const t = useTranslations('GroupForm')
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: group
      ? {
          name: group.name,
          information: group.information ?? '',
          currency: group.currency ?? '',
          currencyCode: group.currencyCode ?? '',
          defaultSplitMode: group.defaultSplitMode ?? 'EVENLY',
          currentPin: '',
          newPin: '',
          clearPin: false,
          fixedExpenseDateGroups: group.fixedExpenseDateGroups ?? false,
          participants: group.participants,
        }
      : {
          name: '',
          information: '',
          currency: '',
          currencyCode: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY_CODE || 'USD', // TODO: If NEXT_PUBLIC_DEFAULT_CURRENCY_CODE, is not set, determine the default currency code based on locale
          defaultSplitMode: 'EVENLY',
          currentPin: '',
          newPin: '',
          clearPin: false,
          fixedExpenseDateGroups: false,
          participants: [
            { name: t('Participants.John') },
            { name: t('Participants.Jane') },
            { name: t('Participants.Jack') },
          ],
        },
  })
  const { fields, append, remove, move, replace } = useFieldArray({
    control: form.control,
    name: 'participants',
    keyName: 'key',
  })

  // The active user select holds a stable value, never a translated label:
  // NO_ACTIVE_USER, a saved participant's id, or NEW_PARTICIPANT_PREFIX plus
  // the name of a participant that has no id until the form is saved.
  const [activeUser, setActiveUser] = useState<string | null>(null)
  useEffect(() => {
    if (activeUser === null) {
      let stored: string | null = null
      try {
        stored = group ? localStorage.getItem(`${group.id}-activeUser`) : null
      } catch {
        // Storage unavailable: start from "None".
      }
      const known = fields.some((f) => f.id && f.id === stored)
      setActiveUser(known && stored ? stored : NO_ACTIVE_USER)
    }
  }, [activeUser, fields, group])

  const watchedParticipants = form.watch('participants')
  const activeUserOptions = [
    { value: NO_ACTIVE_USER, label: t('Settings.ActiveUserField.none') },
    ...watchedParticipants
      .filter((participant) => participant.name.length > 0)
      .map((participant) => ({
        value: participant.id
          ? participant.id
          : `${NEW_PARTICIPANT_PREFIX}${participant.name}`,
        label: participant.name,
      })),
  ]

  /** The saved participant id behind the selection, if it has one. */
  const activeUserId =
    activeUser &&
    activeUser !== NO_ACTIVE_USER &&
    !activeUser.startsWith(NEW_PARTICIPANT_PREFIX)
      ? group?.participants.find((p) => p.id === activeUser)?.id
      : undefined

  const updateActiveUser = () => {
    if (!activeUser) return
    try {
      const newParticipantName = activeUser.startsWith(NEW_PARTICIPANT_PREFIX)
        ? activeUser.slice(NEW_PARTICIPANT_PREFIX.length)
        : null
      if (group?.id) {
        if (newParticipantName !== null) {
          // Gets an id only once saved. The expense list maps this name to
          // the new id when it loads the group again.
          localStorage.setItem(`${group.id}-newUser`, newParticipantName)
        } else {
          localStorage.setItem(
            `${group.id}-activeUser`,
            activeUserId ?? NO_ACTIVE_USER,
          )
        }
      } else {
        // A new group: the expense list maps the name to its id after create.
        localStorage.setItem(
          'newGroup-activeUser',
          newParticipantName ?? NO_ACTIVE_USER,
        )
      }
    } catch {
      // Storage unavailable: the active user is only a convenience.
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          await onSubmit(values, activeUserId)
        })}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('NameField.label')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('NameField.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('NameField.description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultSplitMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('DefaultSplitField.label')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="EVENLY">
                        {t('DefaultSplitField.evenly')}
                      </SelectItem>
                      <SelectItem value="BY_SHARES">
                        {t('DefaultSplitField.byShares')}
                      </SelectItem>
                      <SelectItem value="BY_PERCENTAGE">
                        {t('DefaultSplitField.byPercentage')}
                      </SelectItem>
                      <SelectItem value="BY_AMOUNT">
                        {t('DefaultSplitField.byAmount')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('DefaultSplitField.description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="col-span-2">
              <FormField
                control={form.control}
                name="information"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('InformationField.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-base"
                        maxLength={GROUP_INFORMATION_MAX}
                        {...field}
                        placeholder={t('InformationField.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                  <CurrencySelector
                    currencies={defaultCurrencyList(
                      locale as Locale,
                      t('CurrencyCodeField.customOption'),
                    )}
                    defaultValue={form.watch(field.name) ?? ''}
                    onValueChange={(newCurrency) => {
                      field.onChange(newCurrency)
                      const currency = getCurrency(newCurrency)
                      if (
                        currency.code.length ||
                        form.getFieldState('currency').isTouched
                      )
                        form.setValue('currency', currency.symbol, {
                          shouldValidate: true,
                          shouldTouch: true,
                          shouldDirty: true,
                        })
                    }}
                    isLoading={false}
                  />
                  <FormDescription>
                    {t(
                      group
                        ? 'CurrencyCodeField.editDescription'
                        : 'CurrencyCodeField.createDescription',
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem hidden={!!form.watch('currencyCode')?.length}>
                  <FormLabel>{t('CurrencyField.label')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('CurrencyField.placeholder')}
                      max={5}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('CurrencyField.description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('PinField.title')}</CardTitle>
            <CardDescription>{t('PinField.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group?.hasPin && (
              <p className="text-sm">{t('PinField.enabled')}</p>
            )}
            {group?.hasPin && (
              <FormField
                control={form.control}
                name="currentPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('PinField.current')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        className="text-base max-w-xs"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="newPin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {group?.hasPin ? t('PinField.new') : t('PinField.set')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      className="text-base max-w-xs"
                      placeholder="••••"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('PinField.formatHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {group?.hasPin && (
              <FormField
                control={form.control}
                name="clearPin"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                    </FormControl>
                    <FormLabel>{t('PinField.clear')}</FormLabel>
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('GroupSettings.title')}</CardTitle>
            <CardDescription>{t('GroupSettings.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="fixedExpenseDateGroups"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      {t('GroupSettings.FixedExpenseDateGroupsField.label')}
                    </FormLabel>
                    <FormDescription>
                      {t(
                        'GroupSettings.FixedExpenseDateGroupsField.description',
                      )}
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('Participants.title')}</CardTitle>
              <CardDescription>{t('Participants.description')}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                const currentValues = form.getValues('participants')
                const sorted = [...currentValues].sort((a, b) =>
                  (a.name || '').localeCompare(b.name || ''),
                )
                replace(sorted)
              }}
            >
              {t('Participants.sort')}
            </Button>
          </CardHeader>
          <CardContent>
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (over && active.id !== over.id) {
                  const oldIndex = Number(active.id)
                  const newIndex = Number(over.id)
                  move(oldIndex, newIndex)
                }
              }}
            >
              <SortableContext
                items={fields.map((_, index) => String(index))}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-2">
                  {fields.map((item, index) => (
                    <SortableParticipant key={item.key} id={String(index)}>
                      <li>
                        <FormField
                          control={form.control}
                          name={`participants.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="sr-only">
                                {t('Participants.label', { index: index + 1 })}
                              </FormLabel>
                              <FormControl>
                                <div className="flex gap-2 !mt-0">
                                  <Input
                                    className="text-base"
                                    {...field}
                                    placeholder={t('Participants.new')}
                                  />
                                  {item.id &&
                                  protectedParticipantIds.includes(item.id) ? (
                                    <HoverCard>
                                      <HoverCardTrigger>
                                        <Button
                                          variant="ghost"
                                          className="text-destructive-"
                                          type="button"
                                          size="icon"
                                          disabled
                                          aria-label={t('Participants.remove', {
                                            name: field.value || index + 1,
                                          })}
                                        >
                                          <Trash2 className="w-4 h-4 text-destructive opacity-50" />
                                        </Button>
                                      </HoverCardTrigger>
                                      <HoverCardContent
                                        align="end"
                                        className="text-sm"
                                      >
                                        {t('Participants.protectedParticipant')}
                                      </HoverCardContent>
                                    </HoverCard>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      className="text-destructive"
                                      onClick={() => remove(index)}
                                      type="button"
                                      size="icon"
                                      aria-label={t('Participants.remove', {
                                        name: field.value || index + 1,
                                      })}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`participants.${index}.paymentMethods`}
                          render={({ field }) => (
                            <PaymentMethodsEditor
                              value={field.value}
                              onChange={field.onChange}
                              participantName={form.getValues(
                                `participants.${index}.name`,
                              )}
                            />
                          )}
                        />
                      </li>
                    </SortableParticipant>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </CardContent>
          <CardFooter>
            <Button
              variant="secondary"
              onClick={() => {
                append({ name: '' })
              }}
              type="button"
            >
              {t('Participants.add')}
            </Button>
          </CardFooter>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('Settings.title')}</CardTitle>
            <CardDescription>{t('Settings.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              {activeUser !== null && (
                <FormItem>
                  <FormLabel>{t('Settings.ActiveUserField.label')}</FormLabel>
                  <FormControl>
                    <Select
                      onValueChange={(value) => {
                        setActiveUser(value)
                      }}
                      value={activeUser}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            'Settings.ActiveUserField.placeholder',
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {activeUserOptions.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    {t('Settings.ActiveUserField.description')}
                  </FormDescription>
                </FormItem>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex mt-4 gap-2 flex-wrap">
          <SubmitButton
            loadingContent={t(group ? 'Settings.saving' : 'Settings.creating')}
            onClick={updateActiveUser}
          >
            <Save className="w-4 h-4 mr-2" />{' '}
            {t(group ? 'Settings.save' : 'Settings.create')}
          </SubmitButton>
          {!group && (
            <Button variant="ghost" asChild>
              <Link href="/groups">{t('Settings.cancel')}</Link>
            </Button>
          )}
          {group && onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDelete()}
            >
              {t('Settings.delete')}
            </Button>
          )}
        </div>
      </form>
    </Form>
  )
}
