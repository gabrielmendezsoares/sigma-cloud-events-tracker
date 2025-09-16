import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IBatchWindow, IClientGroupMap, ICompanyMap, IEventMap } from './interfaces/index.js';

const EVENTS_PERIOD_HOURS = 2;
const EVENTS_PERIOD_MILLISECONDS = momentTimezone.duration(EVENTS_PERIOD_HOURS, 'hours').asMilliseconds();
const INCLUDED_CODE_SET = new Set<string>(['E130', 'E131', 'E132', 'E133', '1130', '1131', '1132', '1133']);
const EVENTS_COUNT_THRESHOLD = 30;
const AUXILIARY = '0';
const EVENT_CODE = 'E602';
const EVENT_ID = '167681000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

const fetchEvents = async (
  batches: number = 1,
  date: Date = momentTimezone.utc().toDate()
): Promise<IEventMap.IEventMap[]> => {
  const httpClientInstance = new HttpClientUtil.HttpClient();
  const milliseconds = EVENTS_PERIOD_MILLISECONDS / batches;
  const batchWindowList: IBatchWindow.IBatchWindow[] = [];

  let endDate = momentTimezone.utc(date);

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
  for (let index = 0; index < batches; index += 1) {
    const startDate = momentTimezone.utc(endDate).subtract(milliseconds, 'milliseconds');
    
    batchWindowList.push(
      {
        startDate: startDate.toDate(),
        endDate: endDate.toDate()
      }
    );

    endDate = startDate.subtract(1, 'milliseconds');
  }

  try {
    const responseList = await Promise.all(
      batchWindowList.map(
        async (batchWindow: IBatchWindow.IBatchWindow): Promise<Axios.AxiosXHR<IEventMap.IEventMap[]>> => {
          return await httpClientInstance.get<IEventMap.IEventMap[]>(`https://api.segware.com.br/v1/events?startDate=${ momentTimezone(batchWindow.startDate).toISOString() }&endDate=${ momentTimezone(batchWindow.endDate).toISOString() }`);
        }
      )
    );

    return responseList.flatMap((response: Axios.AxiosXHR<IEventMap.IEventMap[]>) => response.data);
  } catch (error: any) {
    if (error.message === 'Maximum call stack size exceeded' || error.response?.data?.messageKey === 'registers_over_limit') {
      return fetchEvents(batches * 2, endDate.toDate());
    }

    throw error;
  }
};

export const createSigmaCloudEvents = async (includedCucSet: Set<string>): Promise<void> => {
  try {
    await prisma.sigma_cloud_events_tracker_triggers.deleteMany({ where: { updated_at: { lt: momentTimezone.utc().subtract(EVENTS_PERIOD_MILLISECONDS, 'milliseconds').toDate() } } });

    const eventMapList = await fetchEvents();

    const eventBundle = eventMapList.reduce(
      (
        accumulator: Record<string, Record<string, Record<string, number>>>, 
        eventMap: IEventMap.IEventMap
      ): Record<string, Record<string, Record<string, number>>> => {
        const eventMapCuc = eventMap.cuc;

        if (!includedCucSet.has(eventMapCuc)) {
          return accumulator;
        }

        const eventMapCode = eventMap.code;

        if (!INCLUDED_CODE_SET.has(eventMapCode)) {
          return accumulator;
        }

        const accountBundle = accumulator[eventMapCuc] || {};
        const eventMapAccountId = eventMap.accountId;
        const codeCountMap = accountBundle[eventMapAccountId] || {};

        accumulator[eventMapCuc] = accountBundle;
        accountBundle[eventMapAccountId] = codeCountMap;
        codeCountMap[eventMapCode] = (codeCountMap[eventMapCode] || 0) + 1;

        return accumulator;
      },
      {} as Record<string, Record<string, Record<string, number>>>
    );
    
    const sigmaCloudHttpClientInstance = new HttpClientUtil.HttpClient();
    const whatsAppHttpClientInstance = new HttpClientUtil.HttpClient();

    sigmaCloudHttpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

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
                              const accountMapAccountCode = accountMap.accountCode;
                              const accountMapTradeName = accountMap.tradeName;
                              const companyMap = (await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap>(`https://api.segware.com.br/v1/company/${ accountMapCompanyId }`)).data;
                              const companyMapTradeName = companyMap.tradeName;
                              const clientGroupMapList = (await sigmaCloudHttpClientInstance.get<IClientGroupMap.IClientGroupMap[]>(`https://api.segware.com.br/v1/clientGroups`)).data;
                              const clientGroupMap = clientGroupMapList.find((clientGroupMap: IClientGroupMap.IClientGroupMap): boolean => clientGroupMap.id === accountMap.clientGroupId);
                              const clientGroupName = clientGroupMap?.name || 'Vazio';
                              const period = `${ EVENTS_PERIOD_HOURS } horas`;

                              try {
                                await whatsAppHttpClientInstance.post<unknown>(
                                  `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
                                  {
                                    number: process.env.CHAT_PRO_GROUP_JID as string,
                                    message: `⚠️EXCESSO DE EVENTOS⚠️\n\nConta: ${ accountMapAccountCode }\nNome: ${ accountMapTradeName }\nEmpresa: ${ companyMapTradeName }\nGrupo: ${ clientGroupName }\nCódigo: ${ code }\nPeríodo: ${ period }\nQuantidade: ${ count }`
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
                                        complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
                                        eventId: EVENT_ID,
                                        eventLog: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
                                        partition: PARTITION,
                                        protocolType: PROTOCOL_TYPE
                                      }
                                    ]
                                  }
                                );
                    
                                await prisma.sigma_cloud_events_tracker_registers.create(
                                  {
                                    data: {
                                      account_code: accountMapAccountCode,
                                      trade_name: accountMapTradeName,
                                      company_trade_name: companyMapTradeName,
                                      client_group_name: clientGroupName,
                                      code,
                                      period,
                                      quantity: count
                                    }
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
                                      complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
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
                                      complement: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
                                      event_id: EVENT_ID,
                                      event_log: `Advertência: Excesso de eventos detectado, Código: ${ code }, Período: ${ period }, Quantidade: ${ count }`,
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
