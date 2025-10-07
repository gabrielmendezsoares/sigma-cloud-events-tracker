import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IBatchWindowMap, IClientGroupMap, ICompanyMap, IEventMap, IOccurenceMap } from './interfaces/index.js';

const OCCURENCES_PERIOD_HOURS = 2;
const OCCURENCES_PERIOD_MILLISECONDS = momentTimezone.duration(OCCURENCES_PERIOD_HOURS, 'hours').asMilliseconds();
const EVENTS_PERIOD_HOURS = 2;
const EVENTS_PERIOD_MILLISECONDS = momentTimezone.duration(EVENTS_PERIOD_HOURS, 'hours').asMilliseconds();
const SYSTEM_CLOSING_PERSON_ID = 52583;
const EVENTS_COUNT_THRESHOLD = 20;
const ACCOUNT_TRADE_NAME_LENGTH = 14;
const AUXILIARY = '0';
const EVENT_CODE = 'E702';
const EVENT_ID = '167681000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

const fetchOccurences = async (
  date: Date,
  batches: number = 1
): Promise<IOccurenceMap.IOccurenceMap[]> => {
  const httpClientInstance = new HttpClientUtil.HttpClient();
  const milliseconds = OCCURENCES_PERIOD_MILLISECONDS / batches;
  const batchWindowMapList: IBatchWindowMap.IBatchWindowMap[] = [];

  let startDate = momentTimezone.utc(date);

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
  for (let index = 0; index < batches; index += 1) {
    const endDate = momentTimezone.utc(startDate).add((batches - 1) === index ? milliseconds - (batches - 1) : milliseconds, 'milliseconds');
    
    batchWindowMapList.push(
      {
        startDate: startDate.toDate(),
        endDate: endDate.toDate()
      }
    );

    startDate = endDate.add(1, 'milliseconds');
  }

  try {
    const responseList = await Promise.all(
      batchWindowMapList.map(
        async (batchWindow: IBatchWindowMap.IBatchWindowMap): Promise<Axios.AxiosXHR<IOccurenceMap.IOccurenceMap[]>> => {
          return await httpClientInstance.get<IOccurenceMap.IOccurenceMap[]>(`https://api.segware.com.br/v2/occurrences?occurrenceClosingUserId=${ SYSTEM_CLOSING_PERSON_ID }&startDate=${ momentTimezone.utc(batchWindow.startDate).toISOString() }&endDate=${ momentTimezone.utc(batchWindow.endDate).toISOString() }`);
        }
      )
    );

    return responseList.flatMap((response: Axios.AxiosXHR<IOccurenceMap.IOccurenceMap[]>): IOccurenceMap.IOccurenceMap[] => response.data);
  } catch (error: any) {
    if (error.message === 'Maximum call stack size exceeded' || error.response?.data?.messageKey === 'registers_over_limit') {
      return fetchOccurences(startDate.toDate(), batches * 2);
    }

    throw error;
  }
};

const fetchEvents = async (
  date: Date,
  batches: number = 1
): Promise<IEventMap.IEventMap[]> => {
  const httpClientInstance = new HttpClientUtil.HttpClient();
  const milliseconds = EVENTS_PERIOD_MILLISECONDS / batches;
  const batchWindowMapList: IBatchWindowMap.IBatchWindowMap[] = [];

  let startDate = momentTimezone.utc(date);

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
  for (let index = 0; index < batches; index += 1) {
    const endDate = momentTimezone.utc(startDate).add((batches - 1) === index ? milliseconds - (batches - 1) : milliseconds, 'milliseconds');
    
    batchWindowMapList.push(
      {
        startDate: startDate.toDate(),
        endDate: endDate.toDate()
      }
    );

    startDate = endDate.add(1, 'milliseconds');
  }

  try {
    const responseList = await Promise.all(
      batchWindowMapList.map(
        async (batchWindow: IBatchWindowMap.IBatchWindowMap): Promise<Axios.AxiosXHR<IEventMap.IEventMap[]>> => {
          return await httpClientInstance.get<IEventMap.IEventMap[]>(`https://api.segware.com.br/v1/events?startDate=${ momentTimezone.utc(batchWindow.startDate).toISOString() }&endDate=${ momentTimezone.utc(batchWindow.endDate).toISOString() }`);
        }
      )
    );

    return responseList.flatMap((response: Axios.AxiosXHR<IEventMap.IEventMap[]>): IEventMap.IEventMap[] => response.data);
  } catch (error: any) {
    if (error.message === 'Maximum call stack size exceeded' || error.response?.data?.messageKey === 'registers_over_limit') {
      return fetchEvents(startDate.toDate(), batches * 2);
    }

    throw error;
  }
};

export const createSigmaCloudEvents = async (includedCucSet: Set<string>): Promise<void> => {
  try {
    let sigmaCloudEventsTrackerWindow = await prisma.sigma_cloud_events_tracker_window.findFirst();

    if (!sigmaCloudEventsTrackerWindow || momentTimezone.utc().isAfter(momentTimezone.utc(sigmaCloudEventsTrackerWindow.started_at).add(EVENTS_PERIOD_MILLISECONDS, 'milliseconds')))  {
      await prisma.sigma_cloud_events_tracker_window.deleteMany();
      
      sigmaCloudEventsTrackerWindow = await prisma.sigma_cloud_events_tracker_window.create({ data: { id: 1 } });
    }

    const sigmaCloudEventsTrackerWindowStartedAt = sigmaCloudEventsTrackerWindow.started_at;

    await prisma.sigma_cloud_events_tracker_triggers.deleteMany({ where: { created_at: { lt: sigmaCloudEventsTrackerWindowStartedAt } } });
    
    const [
      occurrenceMapList,
      eventMapList
    ] = await Promise.all(
      [
        fetchOccurences(sigmaCloudEventsTrackerWindowStartedAt),
        fetchEvents(sigmaCloudEventsTrackerWindowStartedAt)
      ]
    );  

    const occurrenceBundle: Record<string, IOccurenceMap.IOccurenceMap> = {};
    const eventBundle: Record<string, Record<string, Record<string, number>>> = {}; 

    await Promise.all(
      occurrenceMapList.map(
        async (occurrenceMap: IOccurenceMap.IOccurenceMap): Promise<void> => {
          occurrenceBundle[occurrenceMap.id] = occurrenceMap;
        }
      )
    )

    await Promise.allSettled(
      eventMapList.map(
        async (eventMap: IEventMap.IEventMap): Promise<void> => {
          const eventMapCuc = eventMap.cuc;
  
          if (!includedCucSet.has(eventMapCuc)) {
            return;
          }

          const eventMapOccurenceId = eventMap.occurrenceId;
          const occurenceMap = eventMapOccurenceId ? occurrenceBundle[eventMapOccurenceId] : null;

          if (occurenceMap) {
            return;
          }

          const accountBundle = eventBundle[eventMapCuc] || {};
          const eventMapAccountId = eventMap.accountId;
          const codeCountMap = accountBundle[eventMapAccountId] || {};
          const eventMapCode = eventMap.code;
  
          eventBundle[eventMapCuc] = accountBundle;
          accountBundle[eventMapAccountId] = codeCountMap;
          codeCountMap[eventMapCode] = (codeCountMap[eventMapCode] || 0) + 1;
        }
      )
    );

    const startDate = momentTimezone.utc(sigmaCloudEventsTrackerWindowStartedAt);
    const endDate = startDate.clone().add(EVENTS_PERIOD_MILLISECONDS, 'milliseconds');
    const sigmaCloudHttpClientInstance = new HttpClientUtil.HttpClient();
    const startDateToDate = startDate.clone().subtract(3, 'hours').toDate();
    const endDateToDate = endDate.clone().subtract(3, 'hours').toDate();
    const whatsAppHttpClientInstance = new HttpClientUtil.HttpClient();
    const startDateFormattation = startDate.clone().subtract(3, 'hours').format('YYYY-MM-DD HH:mm:ss');
    const endDateFormattation = endDate.clone().subtract(3, 'hours').format('YYYY-MM-DD HH:mm:ss');
  
    sigmaCloudHttpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

    await Promise.allSettled(
      Object
        .entries(eventBundle)
        .map(
          async([cuc, accountBundle]: [string, Record<string, Record<string, number>>]): Promise<void> => {
            await Promise.allSettled(
              Object
                .entries(accountBundle)
                .map(
                  async ([accountId, codeCountMap]: [string, Record<string, number>]): Promise<void> => {
                    const accountIdInt = parseInt(accountId);
                    
                    await Promise.allSettled(
                      Object
                        .entries(codeCountMap)
                        .map(
                          async ([code, count]: [string, number]): Promise<void> => {
                            const sigmaCloudEventsTrackerTrigger = await prisma.sigma_cloud_events_tracker_triggers.findUnique(
                              { 
                                where: { 
                                  account_id_cuc_code: {
                                    account_id: accountIdInt,
                                    cuc,
                                    code
                                  }
                                } 
                              }
                            );

                            if (!sigmaCloudEventsTrackerTrigger && count >= EVENTS_COUNT_THRESHOLD) {
                              await prisma.sigma_cloud_events_tracker_triggers.create(
                                {
                                  data: { 
                                    account_id: accountIdInt,
                                    cuc,
                                    code
                                  }
                                }
                              );

                              const accountMap = (await sigmaCloudHttpClientInstance.get<IAccountMap.IAccountMap>(`https://api.segware.com.br/v5/accounts/${ accountId }`)).data;
                              const accountMapCompanyId = accountMap.companyId;
                              const clientGroupMapList = (await sigmaCloudHttpClientInstance.get<IClientGroupMap.IClientGroupMap[]>(`https://api.segware.com.br/v1/clientGroups`)).data;
                              const companyMap = (await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap>(`https://api.segware.com.br/v1/company/${ accountMapCompanyId }`)).data;
                              const clientGroupMap = clientGroupMapList.find((clientGroupMap: IClientGroupMap.IClientGroupMap): boolean => clientGroupMap.id === accountMap.clientGroupId);
                              const accountMapAccountCode = accountMap.accountCode;
                              const accountMapTradeName = accountMap.tradeName;
                              const companyMapTradeName = companyMap.tradeName;
                              const clientGroupMapName = clientGroupMap?.name || 'Vazio';

                              await prisma.sigma_cloud_events_tracker_registers.create(
                                {
                                  data: {
                                    account_code: accountMapAccountCode,
                                    trade_name: accountMapTradeName,
                                    company_trade_name: companyMapTradeName,
                                    client_group_name: clientGroupMapName,
                                    cuc,
                                    code,
                                    quantity: count,
                                    period_started_at: startDateToDate,
                                    period_ended_at: endDateToDate
                                  }
                                }
                              );

                              try {
                                await whatsAppHttpClientInstance.post<unknown>(
                                  `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
                                  {
                                    number: process.env.CHAT_PRO_GROUP_JID as string,
                                    message: `⚠️ *EXCESSO DE EVENTOS* ⚠️\n\n*Conta:* ${ accountMapAccountCode }\n*Nome:* ${ accountMapTradeName.length >= ACCOUNT_TRADE_NAME_LENGTH ? accountMapTradeName.slice(0, ACCOUNT_TRADE_NAME_LENGTH).trimEnd() + '...' : accountMapTradeName }\n*Empresa:* ${ companyMapTradeName }\n*Grupo:* ${ clientGroupMapName }\n*CUC*: ${ cuc }\n*Evento:* ${ code }\n*Quantidade:* ${ count }\n*Período Inicial:* ${ startDateFormattation }\n*Período Final:* ${ endDateFormattation }`
                                  },
                                  {
                                    headers: { Authorization: process.env.CHAT_PRO_BEARER_TOKEN },
                                    params: { instance_id: process.env.CHAT_PRO_INSTANCE_ID }
                                  }
                                );
                              } catch (error: unknown) {
                                loggerUtil.error(error instanceof Error ? error.message : String(error));
                              }

                              try {
                                await sigmaCloudHttpClientInstance.post<unknown>(
                                  'https://api.segware.com.br/v3/events/alarm', 
                                  { 
                                    events: [
                                      {
                                        account: accountMapAccountCode,
                                        auxiliary: AUXILIARY,
                                        code: EVENT_CODE,
                                        companyId: accountMapCompanyId,
                                        complement: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                        eventId: EVENT_ID,
                                        eventLog: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                        partition: PARTITION,
                                        protocolType: PROTOCOL_TYPE
                                      }
                                    ]
                                  }
                                );

                                await prisma.sigma_cloud_alarm_events.create(
                                  {
                                    data: {
                                      application_type: 'sigma-cloud-events-tracker',
                                      account: accountMapAccountCode,
                                      auxiliary: AUXILIARY,
                                      code: EVENT_CODE,
                                      company_id: accountMapCompanyId,
                                      complement: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                      partition: PARTITION,
                                      protocol_type: PROTOCOL_TYPE,
                                      status: 'sent'
                                    }
                                  }
                                );
                              } catch (error: unknown) {
                                loggerUtil.error(error instanceof Error ? error.message : String(error));
                                
                                await prisma.sigma_cloud_alarm_events.create(
                                  {
                                    data: {
                                      application_type: 'sigma-cloud-events-tracker',
                                      account: accountMapAccountCode,
                                      auxiliary: AUXILIARY,
                                      code: EVENT_CODE,
                                      company_id: accountMapCompanyId,
                                      complement: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, CUC: ${ cuc }, Código: ${ code }, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                                      partition: PARTITION,
                                      protocol_type: PROTOCOL_TYPE,
                                      status: 'failed'
                                    }
                                  }
                                );
                              }
                            } else if (sigmaCloudEventsTrackerTrigger && count < EVENTS_COUNT_THRESHOLD) {
                              await prisma.sigma_cloud_events_tracker_triggers.delete(
                                { 
                                  where: { 
                                    account_id_cuc_code: {
                                      account_id: accountIdInt,
                                      cuc,
                                      code
                                    }
                                  } 
                                }
                              );
                            }
                          }
                        )
                    );
                  }
                )
            );
          }
        )
    );
  } catch (error: unknown) {
    loggerUtil.error(error instanceof Error ? error.message : String(error));
  }
};
