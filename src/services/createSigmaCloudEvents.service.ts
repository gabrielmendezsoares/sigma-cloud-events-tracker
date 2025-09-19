import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IBatchWindow, IClientGroupMap, ICompanyMap, IEventMap } from './interfaces/index.js';

const EVENTS_PERIOD_HOURS = 2;
const EVENTS_PERIOD_MILLISECONDS = momentTimezone.duration(EVENTS_PERIOD_HOURS, 'hours').asMilliseconds();
const INCLUDED_CODE_SET = new Set<string>(['E130', 'E131', 'E132', 'E133', '1130', '1131', '1132', '1133']);
const EVENTS_COUNT_THRESHOLD = 20;
const AUXILIARY = '0';
const EVENT_CODE = 'E701';
const EVENT_ID = '167681000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

const fetchEvents = async (
  date: Date,
  batches: number = 1
): Promise<IEventMap.IEventMap[]> => {
  const httpClientInstance = new HttpClientUtil.HttpClient();
  const milliseconds = EVENTS_PERIOD_MILLISECONDS / batches;
  const batchWindowList: IBatchWindow.IBatchWindow[] = [];

  let startDate = momentTimezone.utc(date);

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
  for (let index = 0; index < batches; index += 1) {
    const endDate = momentTimezone.utc(startDate).add((batches - 1) === index ? milliseconds - batches : milliseconds, 'milliseconds');
    
    batchWindowList.push(
      {
        startDate: startDate.toDate(),
        endDate: endDate.toDate()
      }
    );

    startDate = endDate.add(1, 'milliseconds');
  }

  try {
    const responseList = await Promise.all(
      batchWindowList.map(
        async (batchWindow: IBatchWindow.IBatchWindow): Promise<Axios.AxiosXHR<IEventMap.IEventMap[]>> => {
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
  const sigmaCloudHttpClientInstance = new HttpClientUtil.HttpClient();
  
  sigmaCloudHttpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

  try {
    const databaseNow: [{ date: Date }] = await prisma.$queryRaw`SELECT NOW() AS date;`;
    
    let sigmaCloudEventsTrackerWindow = await prisma.sigma_cloud_events_tracker_window.findFirst();

    if (!sigmaCloudEventsTrackerWindow || momentTimezone.utc(databaseNow[0].date).isAfter(momentTimezone.utc(sigmaCloudEventsTrackerWindow.started_at).add(EVENTS_PERIOD_MILLISECONDS, 'milliseconds')))  {
      await prisma.sigma_cloud_events_tracker_window.deleteMany();
      
      sigmaCloudEventsTrackerWindow = await prisma.sigma_cloud_events_tracker_window.create({});
    }

    await prisma.sigma_cloud_events_tracker_triggers.deleteMany({ where: { updated_at: { lt: sigmaCloudEventsTrackerWindow.created_at } } });

    const eventMapList = await fetchEvents(sigmaCloudEventsTrackerWindow.created_at);
    const eventBundle: Record<string, Record<string, Record<string, number>>> = {}; 

    await Promise.allSettled(
      eventMapList.map(
        async (eventMap: IEventMap.IEventMap): Promise<void> => {
          const eventMapCuc = eventMap.cuc;
  
          if (!includedCucSet.has(eventMapCuc)) {
            return;
          }
  
          const eventMapCode = eventMap.code;
  
          if (!INCLUDED_CODE_SET.has(eventMapCode)) {
            return;
          }
  
          const accountBundle = eventBundle[eventMapCuc] || {};
          const eventMapAccountId = eventMap.accountId;
          const codeCountMap = accountBundle[eventMapAccountId] || {};
  
          eventBundle[eventMapCuc] = accountBundle;
          accountBundle[eventMapAccountId] = codeCountMap;
          codeCountMap[eventMapCode] = (codeCountMap[eventMapCode] || 0) + 1;
        }
      )
    );
    
    const startDate = momentTimezone.utc(sigmaCloudEventsTrackerWindow.created_at);
    const endDate = momentTimezone.utc(sigmaCloudEventsTrackerWindow.created_at).add(EVENTS_PERIOD_MILLISECONDS, 'milliseconds');
    const whatsAppHttpClientInstance = new HttpClientUtil.HttpClient();
    const startDateFormattation = startDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const endDateFormattation = endDate.clone().format('YYYY-MM-DD HH:mm:ss');

    Promise.allSettled(
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
                              const accountMapClientGroupId = accountMap.clientGroupId;
                              const accountMapAccountCode = accountMap.accountCode;
                              const accountMapTradeName = accountMap.tradeName;
                              const companyMap = (await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap>(`https://api.segware.com.br/v1/company/${ accountMapCompanyId }`)).data;
                              const companyMapTradeName = companyMap.tradeName;
                              const clientGroupMapList = (await sigmaCloudHttpClientInstance.get<IClientGroupMap.IClientGroupMap[]>(`https://api.segware.com.br/v1/clientGroups`)).data;
                              const clientGroupMap = clientGroupMapList.find((clientGroupMap: IClientGroupMap.IClientGroupMap): boolean => clientGroupMap.id === accountMapClientGroupId);
                              const clientGroupMapName = clientGroupMap?.name || 'Vazio';

                              try {
                                await whatsAppHttpClientInstance.post<unknown>(
                                  `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
                                  {
                                    number: process.env.CHAT_PRO_GROUP_JID as string,
                                    message: `⚠️EXCESSO DE EVENTOS⚠️\n\nConta: ${ accountMapAccountCode }\nNome: ${ accountMapTradeName }\nEmpresa: ${ companyMapTradeName }\nGrupo: ${ clientGroupMapName }\nEvento: ${ code }\nPeríodo: ${ startDateFormattation } -> ${ endDateFormattation }\nQuantidade: ${ count }`
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
                                        complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                                        eventId: EVENT_ID,
                                        eventLog: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
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
                                      complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                                      partition: PARTITION,
                                      protocol_type: PROTOCOL_TYPE,
                                      status: 'sent'
                                    }
                                  }
                                );
                    
                                await prisma.sigma_cloud_events_tracker_registers.create(
                                  {
                                    data: {
                                      account_code: accountMapAccountCode,
                                      trade_name: accountMapTradeName,
                                      company_trade_name: companyMapTradeName,
                                      client_group_name: clientGroupMapName,
                                      code,
                                      period: `${ startDateFormattation } -> ${ endDateFormattation }`,
                                      quantity: count
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
                                      complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
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
    )
  } catch (error: unknown) {
    loggerUtil.error(error instanceof Error ? error.message : String(error));
  }
};
