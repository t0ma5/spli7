import { SortableParticipant } from '@/app/groups/[groupId]/edit/sortable-participants'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { GroupFormValues, groupFormSchema } from '@/lib/schemas'
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

  const [activeUser, setActiveUser] = useState<string | null>(null)
  useEffect(() => {
    if (activeUser === null) {
      const currentActiveUser =
        fields.find(
          (f) => f.id === localStorage.getItem(`${group?.id}-activeUser`),
        )?.name || t('Settings.ActiveUserField.none')
      setActiveUser(currentActiveUser)
    }
  }, [t, activeUser, fields, group?.id])

  const updateActiveUser = () => {
    if (!activeUser) return
    if (group?.id) {
      const participant = group.participants.find((p) => p.name === activeUser)
      if (participant?.id) {
        localStorage.setItem(`${group.id}-activeUser`, participant.id)
      } else {
        localStorage.setItem(`${group.id}-activeUser`, activeUser)
      }
    } else {
      localStorage.setItem('newGroup-activeUser', activeUser)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          await onSubmit(
            values,
            group?.participants.find((p) => p.name === activeUser)?.id ??
              undefined,
          )
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
                  <FormDescription>
                    {t('PinField.formatHelp')}
                  </FormDescription>
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
                                Participant #{index + 1}
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
                      defaultValue={activeUser}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            'Settings.ActiveUserField.placeholder',
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { name: t('Settings.ActiveUserField.none') },
                          ...form.watch('participants'),
                        ]
                          .filter((item) => item.name.length > 0)
                          .map(({ name }) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    {t('Settings.ActiveUserField.description')}
                    <br />
                    <br />
                    {t('Settings.ActiveUserField.privacyNote')}
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
