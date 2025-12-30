#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
EMAIL=${1:?알림 받을 메일 주소}
LIMIT=${2:-10}

aws budgets create-budget --account-id "$(account_id)" \
  --budget "{
    \"BudgetName\": \"$NAME-monthly\",
    \"BudgetLimit\": {\"Amount\": \"$LIMIT\", \"Unit\": \"USD\"},
    \"TimeUnit\": \"MONTHLY\",
    \"BudgetType\": \"COST\",
    \"CostTypes\": {\"IncludeCredit\": false, \"IncludeRefund\": false}
  }" \
  --notifications-with-subscribers "[
    {\"Notification\": {\"NotificationType\": \"ACTUAL\",     \"ComparisonOperator\": \"GREATER_THAN\", \"Threshold\": 50,  \"ThresholdType\": \"PERCENTAGE\"},
     \"Subscribers\": [{\"SubscriptionType\": \"EMAIL\", \"Address\": \"$EMAIL\"}]},
    {\"Notification\": {\"NotificationType\": \"ACTUAL\",     \"ComparisonOperator\": \"GREATER_THAN\", \"Threshold\": 100, \"ThresholdType\": \"PERCENTAGE\"},
     \"Subscribers\": [{\"SubscriptionType\": \"EMAIL\", \"Address\": \"$EMAIL\"}]},
    {\"Notification\": {\"NotificationType\": \"FORECASTED\", \"ComparisonOperator\": \"GREATER_THAN\", \"Threshold\": 100, \"ThresholdType\": \"PERCENTAGE\"},
     \"Subscribers\": [{\"SubscriptionType\": \"EMAIL\", \"Address\": \"$EMAIL\"}]}
  ]"
aws budgets describe-budget --account-id "$(account_id)" --budget-name "$NAME-monthly" \
  --query 'Budget.{name:BudgetName,limit:BudgetLimit.Amount,includeCredit:CostTypes.IncludeCredit}'
